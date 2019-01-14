import {BaseRedbox, Redbox} from "./Redbox";
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


/* Hacking a "redbox 1.x" api which just gets the JSON from 
   a copy of the storage/ files

 */


export class Redbox1Files extends Redbox implements Redbox {

	cache: Object;
	errors: Object;
	loaded: boolean;

	constructor(cf: Object) {
		super(cf);
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
	// stores the results in the cache, and returns a list of oids. If pattern
	// has any key/values, it will filter the list of oids by matching their
	// JSON objects against the pattern.

	// subsequent calls to getRecord get their json from the cache.




	async load_files(pattern: Object): Promise<Object[]> {
		const cmd = `find ${this.baseURL} -name "*.tfpackage"`;
		this.cache = {};
		this.errors = {};
		try {
			const { stdout, stderr } = await exec(cmd);
			const files = stdout.split("\n").slice(0, -1);
			for( var i in files ) {
				const fn = files[i];
				const oid = this.path2oid(fn);
				try {
					const o = await fs.readJSON(fn);
					if( ! o['oid'] ) {
						o['oid'] = oid;
					}
					this.cache[o['oid']] = o;
				} catch(e) {
					this.errors[oid] = e.message;
				}
			}

			const oids = Object.keys(this.cache);

			this.loaded = true;
			if( Object.keys(pattern).length === 0 ) {
				return Object.keys(this.cache);
			} else {
				const fields = Object.keys(pattern);
				return Object.keys(this.cache).filter((oid) => {
					const record = this.cache[oid];
					for( var f in fields ) {
						const field = fields[f];
						if( record[field] === pattern[field] ) {
							return true;
						}
					}
					return false;
				}).map((oid) => { return this.cache[oid] });
			}
		} catch(e) {
			console.error("Error scanning files");
			console.error(e);
			return 
		}
	}




	path2oid(fn: string): string {
		return fn.split('/').splice(-2)[0];
	}




	/* createRecord - add an object via the api.

		 @metadata -> object containing the metadata
		 @packagetype -> has to match one of the values supported
		 by this redbox instance
		 @options -> object with the following options
		 oid -> to specify the oid
		 skipReindex -> skip the reindex process

	**/

	async createRecord(metadata: Object, packagetype: string, options?: Object): Promise<string | undefined> {
		return undefined;
	}

	// async deleteRecord(oid: string): Promise<bool> {
	//   let url = '/object/' + oid + '/delete';
	//   let resp = await this.apidelete(url);
	//   if( resp ) {
	//     return true;
	//   } else {
	//     return false;
	//   }
	// }


	/* TODO - updated record */

	/* Returns the record, or undefined if it's not
		 found */

	async getRecord(oid: string): Promise<Object | undefined> {
		if( !this.loaded ) {
			// if the storage hasn't been loaded yet, do it now
			const oids = await this.list({});
		}
		if( !this.cache[oid] ) {
			console.error("Record not found for " + oid);
			return undefined;
		}

		return this.cache[oid];

	}

	/* The record's metadata is metadata about the record, not the
		 metadata stored in the record (that's what getRecord returns)
		 */

	async getRecordMetadata(oid: string): Promise<Object | undefined> {
		return undefined;
	}


	async updateRecordMetadata(oid: string, md: Object): Promise<Object | undefined> {
		return undefined;
	}


	/* ReDBox 1.9 permissions work as follows:
		 the owner (in the recordmetadata/TF_OBJ_META) has view and edit
		 a list of extra users may have been granted view

	 */

	async getPermissions(oid: string): Promise<Object | undefined> {
		try {
			let perms = {view: [], edit: []};
			let response = await this.getRecordMetadata(oid);
			if (response) {
				const owner = response['owner'];
				if (owner) {
					perms['view'].push(owner);
					perms['edit'].push(owner);
				}

				const viewers = await this.getSecurityExceptions(oid);
				perms['view'] = _.union(perms['view'], viewers);
				return perms;
			} else {
				return undefined;
			}
		} catch (e) {
			console.log("Error " + e);
		}
	}


	// looks up the oid's security_exception in the Solr index, which gives
	// a list of other users who have been granted view access

	async getSecurityExceptions(oid: string): Promise<string[]> {
		return [];
	}



	/* the next two are stubs to satisfy the interface */

	async grantPermission(oid: string, permission: string, users: Object): Promise<Object | undefined> {
		return undefined;
	}

	async removePermission(oid: string, permission: string, users: Object): Promise<Object | undefined> {
		return undefined;
	}

	async writeDatastream(oid: string, dsid: string, data: any): Promise<Object> {
		return undefined;
	}


	// the next two won't be hard to do as just file reads

	async listDatastreams(oid: string): Promise<Object> {
		return undefined;
		// try {
		// 	let response = await this.apiget('datastream/' + oid + '/list');
		// 	return response;
		// } catch (e) {
		// 	console.log("Error " + e);
		// 	return undefined;
		// }
	}

	async readDatastream(oid: string, dsid: string): Promise<any> {
		return undefined;
		// try {
		// 	let response = await this.apiget('datastream/' + oid, {datastreamId: dsid});
		// 	return response;
		// } catch (e) {
		// 	console.log("Error " + e);
		// }
	}
}
