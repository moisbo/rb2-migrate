import {BaseRedbox, Redbox} from "./Redbox";
import * as assert from 'assert';

import axios from 'axios';

require('axios-debug')(axios);

import {AxiosInstance} from 'axios';

const qs = require('qs');
const util = require('util');
const _ = require('lodash');

/* Redbox v1.9 api */

/* See https://redbox.restlet.io/ */

export class Redbox1 extends BaseRedbox implements Redbox {

	solrURL: string;
	solrAi: AxiosInstance;

	constructor(cf: Object) {
		super(cf);
		this.version = 'Redbox1';
		this.solrURL = cf['solrURL']; //solrURL works with full http address, example: http://localhost:8000/solr/fascinator
		assert.notEqual(this.solrURL, undefined, 'Undefined solrURL in Redbox1 config');
		console.log("solrURL = " + this.solrURL);
		this.initApiClient();
		this.initSolrClient();
	}

	// a separate axios instance to do solr queries, which are used
	// to look up extra view permissions added via the web frontend

	initSolrClient(): void {
		this.solrAi = axios.create({
			baseURL: this.solrURL,
			headers: {
				"Content-Type": "application/json"
			}
		});
	}

	async info(): Promise<Object> {
		try {
			let resp = await this.apiget('/info');
			return resp;
		} catch (e) {
			console.log(e);
			return {};
		}
	}

  async getNumRecords(ptype?: string): Promise<number> {
   let q = 'packageType:' + ptype;
   try {
     let params = { q: q, rows: 1 };
     let resp = await this.apiget('search', params);
     let response = resp["response"];
     let numFound = response["numFound"];
     return numFound;
   } catch(e) {
     console.log("Error " + e);
     return -1;
   }
 }

	/* returns a list of all the items in the
		 Redbox of the specified type */

  /* changed this to a general filter, haven't applied this to rb2 or the rb interface yet */

	async list(filter: Object, start?: number): Promise<string[]> {
		// let q = 'packageType:' + ptype;
		const q = this.makeSolrQuery(filter);
		if (start === undefined) {
			start = 0;
		}
		try {
			const message = util.format("Solr search: %s: %d", q, start);
			console.log(message)
			if (this.progress) {
				this.progress(message);
			}
			let params = {q: q, start: start};
			let resp = await this.apiget('search', params);
			if (resp) {
				let response = resp["response"];
				let numFound = response["numFound"];
				let docs = response["docs"];
				let ndocs = docs.length;
				console.log("Got " + ndocs); 
				let list = docs.map(d => d.id);
				if (start + ndocs < numFound) {
					let rest = await this.list(filter, start + ndocs);
					list = list.concat(rest);
					return list;
				} else {
					return list;
				}
			} else {
				throw new Error('cannot search');
			}
		} catch (e) {
			console.log("List Redbox1 Items Error " + e);
			return [];
		}
	}

	makeSolrQuery(filter: Object): string {
		return Object.keys(filter).map(k => k + ':' + filter[k]).join('%20AND%20');
	} 

	// async listByWorkflowStep(packageType: string, workflowStep: string, start?: number) {
	// 	let q = `workflow_step:${workflowStep}%20AND%20packageType:${packageType}`;
	// 	if (start === undefined) {
	// 		start = 0;
	// 	}
	// 	try {
	// 		if (this.progress) {
	// 			this.progress(util.format("Searching for %s: %d", workflowStep, start));
	// 		}
	// 		let params = {q: q, start: start};
	// 		let resp = await this.apiget('search', params);
	// 		let response = resp["response"];
	// 		let numFound = response["numFound"];
	// 		let docs = response["docs"];
	// 		let ndocs = docs.length;
	// 		let list = docs.map(d => d.id);
	// 		if (start + ndocs < numFound) {
	// 			let rest = await this.listByWorkflowStep(packageType, workflowStep, start + ndocs);
	// 			list = list.concat(rest);
	// 			return list
	// 		} else {
	// 			return list;
	// 		}
	// 	} catch (e) {
	// 		console.log("listByWorkflowStep Redbox1 Items Error " + e);
	// 		return [];
	// 	}
	// }

	/* createRecord - add an object via the api.

		 @metadata -> object containing the metadata
		 @packagetype -> has to match one of the values supported
		 by this redbox instance
		 @options -> object with the following options
		 oid -> to specify the oid
		 skipReindex -> skip the reindex process

	**/

	async createRecord(metadata: Object, packagetype: string, options?: Object): Promise<string | undefined> {
		let url = '/object/' + packagetype;
		let params: Object = {};
		let resp = await this.apipost(url, metadata, options);
		if (resp && 'oid' in resp) {
			return resp['oid'];
		} else {
			return undefined;
		}
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
		try {
			let response = await this.apiget('recordmetadata/' + oid);
			return response;
		} catch (e) {
			console.log("Error " + e);
			return Promise.reject(() => {
				throw new Error(e)
			});
		}
	}

	/* The record's metadata is metadata about the record, not the
		 metadata stored in the record (that's what getRecord returns)
		 */

	async getRecordMetadata(oid: string): Promise<Object | undefined> {
		try {
			let response = await this.apiget('objectmetadata/' + oid);
			return response;
		} catch (e) {
			console.log("Error " + e);
			return undefined;
		}
	}


	async updateRecordMetadata(oid: string, md: Object): Promise<Object | undefined> {
		try {
			let response = await this.apipost('objectmetadata/' + oid, md);
			return response;
		} catch (e) {
			console.log("Error " + e);
			return undefined;
		}
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
		const url = 'select';
		const params = {
			q: util.format('(id:%s AND item_type:object)', oid),
			fl: 'security_exception',
			wt: 'json'
		};
		let response = await this.solrAi.get(url, {params: params});
		if (response.status === 200) {
			const sresp = response.data['response'];
			if (sresp['numFound']) {
				return sresp['docs'][0]['security_exception'];
			} else {
				return [];
			}
		}
	}


	async getSolrDirect(oid: string): Promise<Object> {
		const url = 'select';
		const params = {
			q: util.format('(id:%s AND item_type:object)', oid),
			wt: 'json'
		};
		let response = await this.solrAi.get(url, {params: params});
		if (response.status === 200) {
			const sresp = response.data['response'];
			if (sresp['numFound']) {
				return sresp['docs'][0];
			} else {
				return {};
			}
		}
	}


	/* the next two are stubs to satisfy the interface */

	async grantPermission(oid: string, permission: string, users: Object): Promise<Object | undefined> {
		return undefined;
	}

	async removePermission(oid: string, permission: string, users: Object): Promise<Object | undefined> {
		return undefined;
	}

	async writeDatastream(oid: string, dsid: string, data: any): Promise<Object> {
		try {
			let response = await this.apipost(
				'datastream/' + oid,
				data,
				{datastreamId: dsid}
			);
			return response;
		} catch (e) {
			console.log("Error " + e);
		}
	}


	async listDatastreams(oid: string): Promise<Object> {
		try {
			let response = await this.apiget('datastream/' + oid + '/list');
			return response;
		} catch (e) {
			console.log("Error " + e);
			return undefined;
		}
	}

	async readDatastream(oid: string, dsid: string): Promise<any> {
		try {
			let response = await this.apiget('datastream/' + oid, {datastreamId: dsid});
			return response;
		} catch (e) {
			console.log("Error " + e);
		}
	}
}
