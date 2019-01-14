import { Redbox} from "./Redbox";
import { Redbox1 } from "./Redbox1";
import * as assert from 'assert';

import axios from 'axios';

require('axios-debug')(axios);

import {AxiosInstance} from 'axios';

const qs = require('qs');
const path = require('path');
const util = require('util');
const _ = require('lodash');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs-extra');


const OBJECT_METADATA = 'TF-OBJ-META';
const OBJECT_RE = /jsonConfigPid=([^.]+)\.json/;

const WORKFLOW_METADATA = 'workflow.metadata';
//const WORKFLOW_RE = /"step":\s+"([^\"]+)")/;
const WORKFLOW_RE = /"step":\s+"([^"]+)"/;

/* Hacking a "redbox 1.x" api which just gets the JSON from 
   a copy of the storage/ files

	NOTE: this now subclasses Redbox1 so that it can use the API to get
	records, because that doesn't require the solr index

 */


export class Redbox1Files extends Redbox1 implements Redbox {

	files: string;
	index: Object;
	errors: Object;
	loaded: boolean;


	constructor(cf: Object) {
		super(cf);
		this.files = cf['files'];
		this.version = 'Redbox1Files';
		this.loaded = false;
	}


	async info(): Promise<Object> {
		return {
			'description': 'This is a fake RedBox1 api which reads JSON from a copy of the storage/ directory'
		};
	}

  async getNumRecords(filt?: Object): Promise<number> {
  	const records = await this.load_files(filt);
  	return records.length;
 }

  /* use the find utility to get a list of .tfpackage files from a tree


     applies filters in a way which mimics Solr queries */
	
	async list(filt: Object, start?: number): Promise<string[]> {
		const records = await this.load_files(filt);
		return records.map(r => { return r['oid'] });   // what about the ones which don't have one?
	}


	// load_files runs find to get the filenames, reads them, parses them as JSON,
	// stores the results in the index, and returns a list of oids. If pattern
	// has any key/values, it will filter the list of oids by matching their
	// JSON objects against the pattern.

	// getRecord used to use the index, but now trying the API on the
	// Redbox1 superclass




	async load_files(pattern: Object): Promise<Object[]> {
		const cmd = `find ${this.files} -name "*.tfpackage"`;
		this.index = {};
		this.errors = {};
		try {
			const { stdout, stderr } = await exec(cmd);
			const files = stdout.split("\n").slice(0, -1);
			for( var i in files ) {
				const fn = files[i];
				const [ dir, oid ] = this.parsePath(fn);
				this.index[oid] = {};
				try {
					const om = await fs.readFile(path.join(dir, OBJECT_METADATA));
					const m = om.toString().match(OBJECT_RE);
					if( m ) {
						this.index[oid]['packageType'] = m[1];
					} else {
						this.index[oid]['packageType'] = 'NOT FOUND';
					}
					const wm = await fs.readFile(path.join(dir, WORKFLOW_METADATA));
					const m2 = wm.toString().match(WORKFLOW_RE);
					if( m2 ) {
						this.index[oid]['workflow_step'] = m2[1];
					} else {
						this.index[oid]['workflow_step'] = 'NOT FOUND';
					}
				} catch(e) {
					console.log("error parsing metadata for " + oid);
					console.log(e.message);
					this.errors[oid] = e.message;
				}
			}

			const oids = Object.keys(this.index);

			this.loaded = true;
			if( Object.keys(pattern).length === 0 ) {
				return Object.keys(this.index);
			} else {
				const fields = Object.keys(pattern);
				return Object.keys(this.index).filter((oid) => {
					const record = this.index[oid];
					for( var f in fields ) {
						const field = fields[f];
						if( record[field] === pattern[field] ) {
							return true;
						}
					}
					return false;
				}).map((oid) => { return this.index[oid] });
			}
		} catch(e) {
			console.error("Error scanning files");
			console.error(e);
			return 
		}
	}




	parsePath(fn: string): string[] {
		const parts = fn.split('/');
		const d = parts.slice(0, parts.length - 1).join('/');
		const f = parts.slice(-1)[0];
		return [ d, f ];
	}


	// 	.splice(-2)[0];
	// }

}
