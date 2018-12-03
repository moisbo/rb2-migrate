//
// Typescript version of Stash 2 -> 3 migration code
//

import {Redbox, Redbox1, Redbox2, RDA} from './Redbox';
import {crosswalk, validate} from './crosswalk';
import {ArgumentParser} from 'argparse';

const MANDATORY_CW = [
	"idfield",
	"source_type",
	"dest_type",
	"workflow",
	"permissions",
	"required",
	"fields",
];

const fs = require('fs-extra');
const config = require('config');
const util = require('util');
const path = require('path');
const winston = require('winston');
const stringify = require('csv-stringify/lib/sync');
const _ = require('lodash');
import {Spinner} from 'cli-spinner';


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
    } else if (cf['version'] === 'RDA') {
      return new RDA(cf);
    } else {
      return new Redbox2(cf);
    }
  }
}


async function loadcrosswalk(packagetype: string): Promise<Object | undefined> {
	const cwf = path.join(config.get("crosswalks"), packagetype + '.json');
	try {
		log.info("Loading crosswalk " + cwf);
		const cw = await fs.readJson(cwf);
		var bad = false;
		MANDATORY_CW.map((f) => {
			if (!(f in cw)) {
				console.log("Crosswalk section missing: " + f);
				bad = true;
			}
		});
		if (bad) {
			return null;
		} else {
			return cw
		}
	} catch (e) {
		log.error("Error loading crosswalk " + cwf + ": " + e);
		return null;
	}
}


async function migrate(options: Object): Promise<void> {
  const source = options['source'];
  const dest = options['dest'];
  const source_type = options['type'];
  const outdir = options['outdir'];
  let limit = _.toInteger(options['number']);
  let start = _.toInteger(options['start']);

  var rbSource, rbDest;

  try {
    rbSource = connect(source);
  } catch(e) {
    log.error("Error connecting to source rb " + source + ": " + e);
    return;
  }

  try {
    rbDest = connect(dest);
  } catch(e) {
    log.error("Error connecting to dest rb " + dest + ": " + e);
    return;
  }

  const cw = await loadcrosswalk(source_type);
  if( ! cw ) {
    return;
  }

  if( source_type !== cw['source_type'] ) {
    log.error("Source type mismatch: " + source_type + '/' + cw['source_type']);
    return;
  }

  const dest_type = cw['dest_type'];

  if( outdir ) {
    await(fs.ensureDir(path.join(outdir, 'originals')));
    await(fs.ensureDir(path.join(outdir, 'new')));
  }


  let runCounter = 0;
  let numRuns = 1;
  let batch = options['batch']

  if (batch > 0) {
      limit = batch;
      const numFound = await rbSource.getNumRecords();
      numRuns = Math.ceil( (numFound - start ) / batch );
      const maxBatchCount = options['maxbatchcount'];
      if (maxBatchCount > 0) {
        numRuns = maxBatchCount;
      }
  }

  while (runCounter < numRuns) {
    console.log(`Execution ${runCounter + 1} of ${numRuns}...\n`);
    try {
      var spinner = new Spinner(`Listing up to ${limit} records: ${source_type}`);
      spinner.setSpinnerString(17);
      spinner.start();
      rbSource.setProgress(s => spinner.setSpinnerTitle(s));
      var results = await rbSource.list(source_type, start, limit);
      if(limit > 0 && results.length > limit) {
        results = results.splice(0, limit);
      }
      let n = results.length;
      var report = [ [ 'oid', 'stage', 'ofield', 'nfield', 'status', 'value' ] ];
      for( var i in results ) {
        let md = await rbSource.getRecord(results[i]);
        spinner.setSpinnerTitle(util.format("Crosswalking %d of %d", Number(i) + 1, results.length));
        const oid = md[cw['idfield']];
        const logger = ( stage, ofield, nfield, msg, value ) => {
          report.push([oid, stage, ofield, nfield, msg, value]);
        };
        const [ mdu, md2 ] = await crosswalk(cw, md, logger, rbSource, rbDest);
        var noid = 'new_' + oid;
        if( rbDest ) {
          if( validate(cw['required'], md2, logger) ) {
            try {
              noid = await rbDest.createRecord(md2, dest_type);
              if( noid ) {
                logger("create", "", "", "", noid);
              } else {
                logger("create", "", "", "null noid", "");
              }
            } catch(e) {
              logger("create", "", "", "create failed", e);
            }
          } else {
            console.log("\nInvalid or incomplete JSON for " + oid +", not migrating");
          }
          if( noid && noid !== 'new_' + oid && !_.isEmpty(cw['permissions'])) {
            const perms = await setpermissions(rbSource, rbDest, oid, noid, md2, cw['permissions']);
            if( perms ) {
              if( 'error' in perms ) {
                logger("permissions", "", "", "permissions failed", perms['error']);
              } else {
                logger("permissions", "", "", "set", perms);
              }
            } else {
              logger("permissions", "", "", "permissions failed", "unknown error");
            }
          }
        }

        if (outdir) {
          dumpjson(outdir, oid, noid, md, mdu, md2);
        }
      }

      spinner.setSpinnerTitle("Done.");
      spinner.stop();
      console.log("\n");
    } catch (e) {
      log.error("Migration error:" + e);
      var stack = e.stack;
      log.error(stack);
    }
    runCounter++;
    start = (runCounter * batch);
  }
  if (outdir) {
    await writereport(outdir, report);
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
		await rbDest.grantPermission(noid, 'view', perms['view']);
		return await rbDest.grantPermission(noid, 'edit', perms['edit']);
	} catch (e) {
		return {'error': e};
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
		path.join(outdir, 'originals', util.format("%s.json", oid)),
		md,
		{spaces: 4}
	);
	await fs.writeJson(
		path.join(outdir, 'originals', util.format("%s_unflat.json", oid)),
		mdu,
		{spaces: 4}
	);
	if (!noid) {
		noid = '_' + oid;
	}
	await fs.writeJson(
		path.join(outdir, 'new', util.format("%s.json", noid)),
		md2,
		{spaces: 4}
	);
}


async function writereport(outdir: string, report: Object): Promise<void> {
	const csvfn = path.join(outdir, "report.csv");
	const csvstr = stringify(report);
	await fs.outputFile(csvfn, csvstr);
}


async function info(source: string) {
	console.log("Source");
	const rbSource = connect(source);
	const r = await rbSource.info();
	console.log(r);
}

const log = getlogger();

var parser = new ArgumentParser({
	version: '0.0.1',
	addHelp: true,
	description: "ReDBox 1.x -> 2.0 migration script"
});


parser.addArgument(
	['-t', '--type'],
	{
		help: "Record type to migrate. Leave out for a list of types.",
		defaultValue: null
	}
);

parser.addArgument(
	['-s', '--source'],
	{
		help: "ReDBox server to migrate records from.",
		defaultValue: "Test1_9"
	}
);

parser.addArgument(
	['-d', '--dest'],
	{
		help: "ReDBox server to migrate records to. Leave out to run in test mode.",
		defaultValue: null
	}
);


parser.addArgument(
	['-o', '--outdir'],
	{
		help: "Write diagnostics and logs to this directory.",
		defaultValue: null
	}
);

parser.addArgument(
	['-n', '--number'],
	{
		help: "Limit migration to first n records",
		defaultValue: null
	}
);

parser.addArgument(
  [ '-b', '--batch'],
  {
    help: "If set, the tool will split migrations in batches. Provide number of records per batch.",
    defaultValue: 0
  }
);

parser.addArgument(
  [ '-a', '--start'],
  {
    help: "If set, sets the starting record number, note to consider sorting order.",
    defaultValue: 0
  }
);

parser.addArgument(
  [ '-m', '--maxbatchcount'],
  {
    help: "If set, sets a hard limit on the number of batches to run. Zero (default), means no limit.",
    defaultValue: 0
  }
);

var args = parser.parseArgs();

if( 'type' in args && args['type'] ){
  migrate(args);
} else {
	info(args['source']);
}
