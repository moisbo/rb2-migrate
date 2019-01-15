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
const OBJECT_RE = /^([^=]+)=(.+)/;
const PACKAGE_KEY = 'jsonConfigPid';

const WORKFLOW_METADATA = 'workflow.metadata';
const WORKFLOW_RE = /"step":\s+"([^"]+)"/;

/* Hacking a "redbox 1.x" api which just gets the JSON from 
   a copy of the storage/ files

	NOTE: this now subclasses Redbox1 so that it can use the API to get
	records, because that doesn't require the solr index

 */


export class Redbox1Files extends Redbox1 implements Redbox {

	files: string;
	index: Object;
	count_files: number;
	count_errors: number;
	count_success: number;
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
		return records.map(r => { return r['oid'] }); 
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
				const [ dir, oid, file ] = this.parsePath(fn);
				this.index[oid] = { 'oid': oid, 'file': file };
				try {
					const om = await this.readObjectMetadata(dir);
					if( om[PACKAGE_KEY] ) {
						const p_array = om[PACKAGE_KEY].split('.');
						this.index[oid]['packageType'] = p_array[0];
					} else {
						this.index[oid]['packageType'] = 'NOT FOUND';
					}
					this.index[oid]['owner'] = om['owner'];
					this.index[oid]['date_created'] = om['date_object_created'].replace(/\\/g,'');
					this.index[oid]['date_modified'] = om['date_object_modified'].replace(/\\/g,'');
					this.index[oid]['rules_oid'] = om['rulesOid'];

					// the workflow.metadata files are json, but a lot of them are invalid
					// so I'm using a regexp
					const wm = await fs.readFile(path.join(dir, WORKFLOW_METADATA));
					const m = wm.toString().match(WORKFLOW_RE);
					if( m ) {
						this.index[oid]['workflow_step'] = m[1];
					} else {
						this.index[oid]['workflow_step'] = 'NOT FOUND';
					}
				} catch(e) {
					console.log("error parsing metadata for " + oid);
					console.log(e.message);
					this.errors[oid] = { 'file': file, 'oid': oid, 'error': e.message };
				}
			}

			this.count_files = files.length;
			this.count_errors = Object.keys(this.errors).length;
			const oids = Object.keys(this.index);
			this.count_success = oids.length;

			this.loaded = true;
			if( Object.keys(pattern).length === 0 ) {
				return Object.keys(this.index).map((oid => { return this.index[oid] }));
			} else {
				const fields = Object.keys(pattern);
				const nindex = {};
				for( var oid in this.index ) {
					const record = this.index[oid];
					var include = true;
					for( var f in fields ) {
						const field = fields[f];
						if( record[field] !== pattern[field] ) {
							include = false;
						}
					}
					if( include ) {
						nindex[oid] = record;
					}
				}
				this.index = nindex;
				return Object.keys(this.index).map((oid) => { return this.index[oid] });
			}
		} catch(e) {
			console.error("Error scanning files");
			console.error(e);
			return 
		}
	}




	parsePath(sPath: string): string[] {
		const parts = sPath.split('/');
		const d = parts.slice(0, parts.length - 1).join('/');
		const oid = parts.slice(-2)[0];
		const fn = parts.slice(-1)[0];
		return [ d, oid, fn ];
	}

	async readObjectMetadata(dir: string): Promise<Object> {
		const om = await fs.readFile(path.join(dir, OBJECT_METADATA));
		const o = {}
		om.toString().split('\n').map((l) => {
			const m = l.match(OBJECT_RE);
			if( m ) {
				o[m[1]] = m[2];
			}
		});
		return o;
	}


	// 	.splice(-2)[0];
	// }

}
