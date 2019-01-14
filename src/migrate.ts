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
import {Spinner} from 'cli-spinner';
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


async function migrate(options: Object): Promise<void> {
	const source = options['source'];
	const dest = options['dest'];
	const crosswalk_file = options['file'];
	const dateReport = moment().format('DDMMYYHHMMSS');
	const outdir = options['outdir'] || path.join(process.cwd(), `report_${crosswalk_file}_${dateReport}`);
	const limit = options['number'];

	const cw = await loadcrosswalk(`${crosswalk_file}.json`);
	let cwPub, mdPub, mduPub, md2Pub = null;
	let recordMeta = {};
	let pubDestType;
	if (options['publish']) {
		cwPub = await loadcrosswalk(`${crosswalk_file}.publication.json`);
	}
	const source_type = cw['source_type'];

	if (!cw) {
		return;
	}

	// if (source_type !== cw['source_type']) {
	// 	log.error("Source type mismatch: " + source_type + '/' + cw['source_type']);
	//  throw new Error(e);;
	// }

	const dest_type = cw['dest_type'];

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

	try {
		// var spinner = new Spinner("Listing records: " + source_type);
		// spinner.setSpinnerString(17);
		// spinner.start();
		// rbSource.setProgress(s => spinner.setSpinnerTitle(s));
		var results;
		if (cw['workflow_step']) {
			results = await rbSource.list({ packageType: source_type, workflow_step: cw['workflow_step'] });
		} else {
			results = await rbSource.list({ packageType: source_type });
		}
		if (limit && parseInt(limit) > 0) {
			results = results.splice(0, limit);
		}
		log.info(`Received ${results.length} oids`);
		const n_old = results.length;
		var n_crosswalked = 0;
		var n_created = 0;
		var n_pub = 0;

		const errors = rbSource.errors;
		var report = [['oid', 'stage', 'ofield', 'nfield', 'status', 'value']];

		const n_errors = Object.keys(errors).length;
		for( var oid in errors ) {
			report.push([oid, 'list', '', '', 'error', errors[oid]]);
		}


		for (var i in results) {
			log.info(`Processing oid ${results[i]}`);
			let md = await rbSource.getRecord(results[i]);
			//spinner.setSpinnerTitle(util.format("Crosswalking %d of %d", Number(i) + 1, results.length));
			if( !md ) {
				// log.error(`Missing record for ${results[i]}`);
				continue;
			}
			const oid = md[cw['idfield']] || results[i]; //Some records do not contain the oid in its metadata!
			const logger = (stage, ofield, nfield, msg, value) => {
				if( stage === 'postwalk' ) {
					console.trace("postwalk logger");
				}
				report.push([oid, stage, ofield, nfield, msg, value]);
			};
			const [mdu, md2] = crosswalk(cw, md, logger);
			n_crosswalked += 1;
			var noid = 'new_' + oid;
			if (rbDest) {
				if (validate(cw['required'], md2, logger)) {
					try {
						noid = await rbDest.createRecord(md2, dest_type);
						if (noid) {
							n_created += 1;
							logger('create', '', '', '', noid);
						} else {
							logger('create', '', '', 'null noid', '');
						}
					} catch (e) {
						logger('create', '', '', 'create failed', e);
					}
				} else {
					console.log('\nInvalid or incomplete JSON for ' + oid + ', not migrating');
				}
				if (noid && noid !== 'new_' + oid) {
					try {
						const perms = await setpermissions(rbSource, rbDest, noid, oid, md2, cw['permissions']);
						if (perms) {
							if ('error' in perms) {
								logger('permissions', '', '', 'permissions failed', perms['error']);
							} else {
								logger('permissions', '', '', 'set', perms);
							}
						} else {
							logger('permissions', '', '', 'permissions failed', 'unknown error');
						}
					} catch (e) {
						logger('setpermissions', '', '', 'setpermissions failed', e);
					}
					try {
						recordMeta = await rbDest.getRecord(noid);
					} catch (e) {
						logger('getRecord', '', '', 'getRecord failed', e);
					}
					try {
						const newRecordMeta = postwalk(cw['postTasks'], recordMeta, logger);
						const enoid = await rbDest.updateRecordMetadata(noid, newRecordMeta);
					} catch (e) {
						logger('updateRecordMetadata', '', '', 'updateRecordMetadata postwalk failed', e);
					}
					if (cwPub) {
						try {
							let mdPub = await rbSource.getRecord(oid);
							const resPub = crosswalk(cwPub, mdPub, logger);
							mduPub = resPub[0];
							md2Pub = resPub[1];
							md2Pub[cwPub['dest_type']] = {
								oid: noid,
								title: recordMeta['title']
							};
						} catch (e) {
							logger('getRecord', '', '', 'getRecord for publication failed', e);
						}
						n_pub += 1;
						const pubOid = await rbDest.createRecord(md2Pub, cwPub['dest_type']);
					}
				}
			}

			if (outdir) {
				dumpjson(outdir, oid, noid, md, mdu, md2);
			}
		}

		//spinner.setSpinnerTitle('Done.');
		//spinner.stop();


		await writereport(outdir, report);

		const summary = `Summary
${n_old} records read from ${source}
${n_errors} records had JSON errors
${n_crosswalked} crosswalked 
${n_created} created as ${dest_type} in ${dest}
${n_pub} created as publications in ${dest}
`;

		console.log(summary);
		log.info(summary);


	} catch (e) {
		log.error('Migration error:' + e);
		var stack = e.stack;
		log.error(stack);
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


async function writereport(outdir: string, report: Object): Promise<void> {
	const csvfn = path.join(outdir, 'report.csv');
	const csvstr = stringify(report);
	await fs.outputFile(csvfn, csvstr);
}


async function info(source: string) {
	console.log('Source');
	const rbSource = connect(source);
	const r = await rbSource.info();
	console.log(r);
}

const log = getlogger();

var parser = new ArgumentParser({
	version: '0.0.1',
	addHelp: true,
	description: 'ReDBox 1.x -> 2.0 migration script'
});


parser.addArgument(
	['-f', '--file'],
	{
		help: 'Crosswalk file to use (with the .json missing)',
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
		defaultValue: null
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
	['-p', '--publish'],
	{
		help: 'Copys records into publication draft',
		defaultValue: false
	}
);

var args = parser.parseArgs();

if ('file' in args && args['file']) {
	migrate(args);
} else {
	info(args['source']);
}
