//
// Typescript version of Stash 2 -> 3 migration code
//

import {Redbox, Redbox1, Redbox1Files, Redbox2} from './Redbox';
import {crosswalk, validate} from './crosswalk';
import {ArgumentParser} from 'argparse';
import * as moment from 'moment';

const MANDATORY_CW = [
	'idfield',
	'source_type',
	'dest_type',
	'workflow',
	'permissions',
	'required',
	'fields',
];

const fs = require('fs-extra');
const config = require('config');
const util = require('util');
const path = require('path');
const winston = require('winston');
const stringify = require('csv-stringify/lib/sync');
const _ = require('lodash');
import {postwalk} from './postwalk';


function getlogger() {
	const logcfs = config.get('logs');
	return winston.createLogger({
		level: 'error',
		format: winston.format.simple(),
		transports: logcfs.map((cf) => {
			if ('filename' in cf) {
				return new winston.transports.File(cf);
			} else {
				return new winston.transports.Console();
			}
		})
	});
}

function connect(server: string): Redbox {
  if( server ) {
    const cf = config.get('servers.' + server);
    if( cf['version'] === 'Redbox1' ) {
      return new Redbox1(cf);
    } else if( cf['version'] === 'Redbox1Files' ) {
    	return new Redbox1Files(cf);
    // } else if (cf['version'] === 'RDA') {
    //   return new RDA(cf);
    } else {
      return new Redbox2(cf);
    }
  }
}


async function loadcrosswalk(packagetype: string): Promise<Object | undefined> {

	const cwf = path.join(config.get('crosswalks'), packagetype);
	try {
		log.info('Loading crosswalk ' + cwf);
		const cw = await fs.readJson(cwf);
		var bad = false;
		MANDATORY_CW.map((f) => {
			if (!(f in cw)) {
				console.log('Crosswalk section missing: ' + f);
				bad = true;
			}
		});
		if (bad) {
			return null;
		} else {
			return cw
		}
	} catch (e) {
		log.error('Error loading crosswalk ' + cwf + ': ' + e);
		return null;
	}
}

// info: prints out info about a source to STDOUT, including a list of
// available crosswalk files

async function info(source: string) {
	console.log('Source');
	const rbSource = connect(source);
	const r = await rbSource.info();
	console.log(r);
  const crosswalk_d = config.get('crosswalks');
  if( crosswalk_d ) {
  	console.log("Available crosswalks:");
	  const d = await fs.readdir(crosswalk_d);
  	d.map((f) => {
  		var m = f.match(/^(.*?)\.json$/);
  		if( m ) {
  			console.log(m[1]);
  		}
  	});
  	console.log("");
  	console.log("Run the script with --index and no --crosswalk for a list of all records in --source");
  } else {
  	console.log("No crosswalks configured");
  }
}



// index: calls source.list to get a list of oids for the requested
// crosswalk, or all oids in the source if there's no crosswalk.

// returns two lists of objects: an index of {} representing each
// oid, and a list of errors

async function index(options: Object): Promise<Object[][]> {
	const source = options['source'];
	const crosswalk_file = options['crosswalk'];
	const limit = options['number'];

	var rbSource;

	try {
		rbSource = connect(source);
	} catch (e) {
		log.error('Error connecting to source rb ' + source + ': ' + e);
		throw new Error(e);
	}

	var oids;

	if( crosswalk_file ) {
		const cw = await loadcrosswalk(`${crosswalk_file}.json`);
		const source_type = cw['source_type'];

		if (cw['workflow_step']) {
			oids = await rbSource.list({ packageType: source_type, workflow_step: cw['workflow_step'] });
		} else {
			oids = await rbSource.list({ packageType: source_type });
		} 
	} else {
		oids = await rbSource.list({});
	}
	console.log(`Loaded index of ${oids.length} records`);
	if (limit && parseInt(limit) > 0) {
			oids.splice(limit);
			console.log(`Limited to first ${oids.length} records`);
	}

	// hack - get all of the index objects out of rbSource so that
	// the migrate function doesn't need to rely on it

	const records = oids.map((oid) => { return rbSource.index[oid] } );
	const errors = rbSource.errors;

	console.log(`Parse errors for ${errors.length} items`);

	return [ records, errors ];
}


// migrate - takes the list of records from index() plus the args
// object, and returns a new copy of the index (with extra metadata and
// status messages from the crosswalk) and the detailed report.

// Note that even after refactoring index() out of it, this function is
// still a mess

async function migrate(options: Object, outdir: string, records: Object[]): Promise<Object[][]> {
	const source = options['source'];
	const dest = options['dest'];
	const crosswalk_file = options['crosswalk'];

	const cw = await loadcrosswalk(`${crosswalk_file}.json`);
	const source_type = cw['source_type'];
	const dest_type = cw['dest_type'];
	let cwPub, mdPub, mduPub, md2Pub = null;
	let recordMeta = {};
	let pubDestType;
	if (options['publish']) {
		cwPub = await loadcrosswalk(`${crosswalk_file}.publication.json`);
	}

	var rbSource, rbDest;

	try {
		rbSource = connect(source);
	} catch (e) {
		log.error('Error connecting to source rb ' + source + ': ' + e);
		throw new Error(e);
	}

	try {
		rbDest = connect(dest);
	} catch (e) {
		log.error('Error connecting to dest rb ' + dest + ': ' + e);
		throw new Error(e);
	}

	if (outdir) {
		fs.ensureDirSync(path.join(outdir, 'originals'));
		fs.ensureDirSync(path.join(outdir, 'new'));
	}

	log.info(`Received ${records.length} oids`);
	const n_old = records.length;
	var n_crosswalked = 0;
	var n_created = 0;
	var n_pub = 0;

	var report_lines = [['oid', 'stage', 'ofield', 'nfield', 'status', 'value']];

	const updated = {};

	try {

		for( var i in records ) {
			const record = records[i];
			const oid = record['oid'];
			updated[oid] = _.clone(record);
			log.info(`Processing oid ${oid}`);

			let md = await rbSource.getRecord(oid);
			if( !md ) {
				log.error(`Couldn't get record for ${oid}`);
				updated[oid]['status'] = 'load failed';
				continue;
			}


			updated[oid]['title'] = md['dc:title'];
			updated[oid]['description'] = md['dc:description'];

			const report = (stage, ofield, nfield, msg, value) => {
				report_lines.push([oid, stage, ofield, nfield, msg, value]);
				updated[oid]['status'] = msg + ': ' + value; // status is always last thing
			};

			if( !record['owner'] ) {
			 	report('load', '', '', 'no owner', '');
			 	continue;
			}


			const [mdu, md2] = crosswalk(cw, md, report);
			updated[oid]['status'] = 'crosswalked';
			n_crosswalked += 1;
			var noid = 'new_' + oid;

			if (outdir) {
				dumpjson(outdir, oid, noid, md, mdu, md2);
			}

			const errors = validate(record['owner'], cw['required'], md2, report);

			if ( errors.length > 0 ) {
				report('validate', '', '', 'invalid', errors.join('; '));
				continue;
			} else {
				// this will be the last status if we're in dry-run/index mode, so
				// it overwrites any warnings from validate() above
				report('validate', '', '', 'valid', '');
			}

			if( !rbDest || args['index'] ) {
				continue;
			}

			try {
				noid = await rbDest.createRecord(md2, dest_type);
				if (noid) {
					n_created += 1;
					updated[oid]['noid'] = noid;
					report('create', '', '', 'created', noid);
				} else {
					throw('null oid');
				}
			} catch (e) {
				report('create', '', '', 'create failed', e);
				continue;
			}

			try {
				const perms = await setpermissions(rbSource, rbDest, noid, oid, md2, cw['permissions']);
				if( !perms ) {
					throw('unknown error');
				}
				if ('error' in perms) {
					throw(perms['error']);
				}
				report('permissions', '', '', 'set', perms);
			} catch (e) {
				report('permissions', '', '', 'failed', e);
			}

			try {
				recordMeta = await rbDest.getRecord(noid);
			} catch (e) {
				report('postwalk', '', '', 'getRecord failed', e);
				continue;
			}

			try {
				const newRecordMeta = postwalk(cw['postTasks'], recordMeta, report);
				const enoid = await rbDest.updateRecordMetadata(noid, newRecordMeta);
			} catch (e) {
				report('updateRecordMetadata', '', '', 'postwalk failed', e);
			}

			if (!cwPub) {
				continue;
			}
			
			try {
				let mdPub = await rbSource.getRecord(oid);
				const resPub = crosswalk(cwPub, mdPub, report);
				mduPub = resPub[0];
				md2Pub = resPub[1];
				md2Pub[cwPub['dest_type']] = {
					oid: noid,
					title: recordMeta['title']
				};
				n_pub += 1;
				const pubOid = await rbDest.createRecord(md2Pub, cwPub['dest_type']);
				report('published', '', '', 'publication created', '');
			} catch (e) {
				report('published', '', '', 'publish failed', e);
			}
		}

 		console.log(`${n_crosswalked} crosswalked`);
 		if( dest ) {
 			console.log(`${n_created} created as ${dest_type} in ${dest}`);
 			if( n_pub ) {
				console.log(`${n_pub} created as publications in ${dest}`);
			}
		} else {
			console.log("No --dest specified, no records created.");
		}

		const updated_list = [];

		for( i in records ) {
			const oid = records[i]['oid'];
			updated_list.push(updated[oid]);
		}

		return [ updated_list, report_lines ];

	} catch (e) {
		log.error('Migration error:' + e);
		var stack = e.stack;
		log.error(stack);
		return [ [], [] ];
	}

}


// Set the permissions on a newly created record. Works like this:
//
// - read the permissions from the old record
// - add edit, view for the FNCI and Data Manager of the new record
// - add view for all of the contributors of the new record
//
// This preserves any extra people granted view access in RB 1.9

async function setpermissions(rbSource: Redbox, rbDest: Redbox, noid: string, oid: string, md2: Object, pcw: Object): Promise<Object> {
	var perms = await rbSource.getPermissions(oid);
	var nperms = {view: [], edit: []};
	if (!perms) {
		perms = {view: [], edit: []};
	}
	const users = await usermap(rbSource, oid, md2, pcw);
	for (const cat in users) {
		for (const user in users[cat]) {
			for (const p in pcw[cat]) {
				if (!(user in perms[p])) {
					perms[p].push(user);
				}
			}
		}
		['view, edit '].map((p) => perms[p] = _.union(perms[p], nperms[p]));
	}
	try {
		const view = await rbDest.grantPermission(noid, 'view', perms['view']);
		const edit = await rbDest.grantPermission(noid, 'edit', perms['edit']);
	} catch (e) {
		return {'error granting permissions': e};
	}
}


// build a dict of user categories (ie contributor_ci) to lists of user IDs

async function usermap(rbSource: Redbox, oid: string, md2: Object, pcw: Object): Promise<{ [cat: string]: [string] }> {
	var users = {};

	const id_field = pcw['user_id'];

	for (var c in pcw['permissions']) {
		if (c === '_owner') {
			const oldperms = await rbSource.getPermissions(oid);
			users[c] = [oldperms['edit'][0]];
		} else if (c in md2) {
			if (Array.isArray(md2[c])) {
				users[c] = md2[c].map((u) => u[id_field])
			} else {
				users[c] = [md2[c][id_field]];
			}
		}
	}
	return users;
}


async function dumpjson(outdir: string, oid: string, noid: string, md: Object, mdu: Object, md2: Object): Promise<void> {
	await fs.writeJson(
		path.join(outdir, 'originals', util.format('%s.json', oid)),
		md,
		{spaces: 4}
	);
	await fs.writeJson(
		path.join(outdir, 'originals', util.format('%s_unflat.json', oid)),
		mdu,
		{spaces: 4}
	);
	if (!noid) {
		noid = '_' + oid;
	}
	await fs.writeJson(
		path.join(outdir, 'new', util.format('%s.json', noid)),
		md2,
		{spaces: 4}
	);
}


async function writeindex(index_o: Object, filename: string): Promise<void> {
	const index_headers = [
	'oid', 'noid', 'file', 'packageType', 'workflow_step', 'owner', 'title', 'description',
	'status', 'date_created', 'date_modified', 'rules_oid'
	];
	const index = [ index_headers ];
	for( var oid in index_o ) {
		index.push(index_headers.map((f) => { return index_o[oid][f] }));
	}
	await writereport(index, filename);
}


async function writeerrors(errors_o: Object, filename: string): Promise<void> {
	const error_headers = [
	'oid', 'file', 'error'
	];
	const errors = [ error_headers ];
	for( var oid in errors_o ) {
		errors.push(error_headers.map((f) => { return errors_o[oid][f] }));
	}
	await writereport(errors, filename);
}

async function writereport(report: Object, fn: string): Promise<void> {
	console.log(`Writing csv to ${fn}: ${JSON.stringify(report[0])}`);
	const csvstr = stringify(report);
	await fs.outputFile(fn, csvstr);
	console.log('Done');
}


async function main(args) {

	const timestamp = Date.now().toString();
	const name = args['crosswalk'] || 'all';
	const outdir = path.join(args['outdir'], `report_${name}_${timestamp}`);

	if ( !( args['crosswalk'] || args['index'] ) ) {
		info(args['source']);
	} else {
		const [ records, errors ] = await index(args);
		await writeerrors(errors, path.join(outdir, `errors_${timestamp}.csv`));

		if( args['crosswalk'] ) {
			const [ updated_records, report ] = await migrate(args, outdir, records);
			await writeindex(updated_records, path.join(outdir, `index_${timestamp}.csv`));
			await writereport(report, path.join(outdir, `report_${timestamp}.csv`));
		} else {
			await writeindex(records, path.join(outdir, `index_${timestamp}.csv`));
		}
	}
}







const log = getlogger();

var parser = new ArgumentParser({
	version: '0.0.1',
	addHelp: true,
	description: 'ReDBox 1.x -> 2.0 migration script'
});


parser.addArgument(
	['-c', '--crosswalk'],
	{
		help: 'Crosswalk (package type + workflow step). Leave empty for a list of available crosswalks.',
		defaultValue: null
	}
);

parser.addArgument(
	['-s', '--source'],
	{
		help: 'ReDBox server to migrate records from.',
		defaultValue: 'Test1_9'
	}
);

parser.addArgument(
	['-d', '--dest'],
	{
		help: 'ReDBox server to migrate records to. Leave out to run in test mode.',
		defaultValue: null
	}
);


parser.addArgument(
	['-o', '--outdir'],
	{
		help: 'Write diagnostics and logs to this directory.',
		defaultValue: './'
	}
);

parser.addArgument(
	['-n', '--number'],
	{
		help: 'Limit migration to first n records',
		defaultValue: null
	}
);

parser.addArgument(
	['-i', '--index'],
	{
		help: 'Only write an index of the records to be crosswalked. If no --crosswalk is given, indexes all records.',
		action: 'storeTrue',
		defaultValue: false
	}
);

parser.addArgument(
	['-p', '--publish'],
	{
		help: 'Copies records into publication draft',
		action: 'storeTrue',
		defaultValue: false
	}
);

const args = parser.parseArgs();

main(args);

