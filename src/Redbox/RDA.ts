
import { BaseRedbox, Redbox } from "./Redbox";

import axios from 'axios';

require('axios-debug')(axios);

import { AxiosInstance } from 'axios';
const qs = require('qs');
const util = require('util');
const _ = require('lodash');

/* RDA Api */

export class RDA extends BaseRedbox implements Redbox {

  solrURL: string;
  solrAi: AxiosInstance;
  bucket: any;
  apiUrl: string;

  constructor(cf: Object) {
    super(cf)
    this.version = 'RDA';
    // this.solrURL = cf['solrURL'];
    // console.log("solrURL = " + this.solrURL);
    this.initApiClient();
    // this.initSolrClient();
  }

  initApiClient() {
    this.apiUrl = `${this.baseURL}${this.apiKey}/`
    this.ai = axios.create({
      baseURL: this.apiUrl,
      headers: {
	      "Content-Type": "application/json"
      },
      paramsSerializer: function(params) {
	      return qs.stringify(params, { encode: false });
      }
    });

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
    } catch(e) {
      console.log(e);
      return {};
    }
  }

  async getNumRecords(ptype?: string): Promise<number> {
    const q = "class:collection";
    try {

      let params = { q: q, fl: '*', rows: '1', start: '0' };
      let resp = await this.apiget('getMetadata.json', params);
      let response = resp["message"];
      const numFound = response["numFound"];
      return numFound;
    } catch(e) {
      console.log("Error " + e);
      return -1;
    }
  }

  /* returns a list of all the items in the
     Redbox of the specified type
     Additionally, for RDA the 'cache' is cleared in between list calls
     */

  async list(ptype: string, start?:number, limit?:number): Promise<string[]> {
    let q = `class:collection`;
    if( start === undefined ) {
      start = 0;
    }
    // clear the bucket cache, don't hold on forever
    this.bucket = {};

    try {

      let params = { q: q, start: start, fl: '*' };
      if (limit > 0) {
        params['rows'] = limit;
      }
      let resp:any = await this.apiget('getMetadata.json', params);
      let response = resp["message"];
      let numFound = response["numFound"];
      let docs = response["docs"];
      let ndocs = docs.length
      let list = docs.map(d => d.id);
      _.each(docs, (d) => {
        this.bucket[d.id] = d;
      });
      if (this.progress) {
        this.progress(util.format("Searching for %s: %d of %d", ptype, start, numFound));
      }
      if ( limit <= 0 && start + ndocs < numFound ) {
	       let rest = await this.list(ptype, start + ndocs);
	       list = list.concat(rest);
      }
      return list;
    } catch(e) {
      console.log("Error " + e);
      return [];
    }
  }


  /* createRecord - add an object via the api.

     @metadata -> object containing the metadata
     @packagetype -> has to match one of the values supported
     by this redbox instance
     @options -> object with the following options
     oid -> to specify the oid
     skipReindex -> skip the reindex process

  **/

  async createRecord(metadata: Object, packagetype: string, options?: Object): Promise<string|undefined> {
    let url = '/object/' + packagetype;
    let params: Object = {};
    let resp = await this.apipost(url, metadata, options);
    if( resp && 'oid' in resp ) {
      return resp['oid'];
    } else {
      return undefined;
    }
  }

  /* TODO - updated record */

  /* Returns the record, or undefined if it's not
     found */

  async getRecord(oid: string): Promise<Object|undefined> {
    if (!_.isEmpty(this.bucket[oid])) {
      return this.bucket[oid];
    }
    // try to lookup one record...
    let params = { q: `id:${oid}`, start: 0, fl: '*' };
    let resp = await this.apiget('getMetadata.json', params);
    let response = resp["message"];
    if (response.numFound == 0) {
      return undefined;
    }
    this.bucket[oid] = response.docs[0];
    return this.bucket[oid];
  }

  /* The record's metadata is metadata about the record, not the
     metadata stored in the record (that's what getRecord returns)
     */

  async getRecordMetadata(oid: string): Promise<Object|undefined> {
    try {
      let response = await this.apiget('objectmetadata/' + oid);
      return response;
    } catch(e) {
      console.log("Error " + e);
      return undefined;
    }
  }


  async updateRecordMetadata(oid: string, md: Object): Promise<Object|undefined> {
    try {
      let response = await this.apipost('objectmetadata/' + oid, md);
      return response;
    } catch(e) {
      console.log("Error " + e);
      return undefined;
    }
  }


  /* ReDBox 1.9 permissions work as follows:
     the owner (in the recordmetadata/TF_OBJ_META) has view and edit
     a list of extra users may have been granted view

   */

  async getPermissions(oid: string): Promise<Object|undefined> {
    try {
      return { view: ["admin"], edit: ["admin"] };
    } catch(e) {
      console.log("Error " + e);
    }
  }



  /* the next two are stubs to satisfy the interface */

  async grantPermission(oid: string, permission: string, users:Object): Promise<Object|undefined> {
    return undefined;
  }

  async removePermission(oid: string, permission: string, users:Object): Promise<Object|undefined> {
    return undefined;
  }

  async writeDatastream(oid: string, dsid: string, data: any): Promise<Object> {
    try {
      let response = await this.apipost(
        'datastream/' + oid,
        data,
        { datastreamId: dsid }
      );
      return response;
    } catch(e) {
      console.log("Error " + e);
    }
  }


  async listDatastreams(oid: string): Promise<Object> {
    try {
      let response = await this.apiget('datastream/' +oid + '/list');
      return response;
    } catch(e) {
      console.log("Error " + e);
      return undefined;
    }
  }

  async readDatastream(oid: string, dsid: string): Promise<any> {
    try {
      let response = await this.apiget('datastream/' + oid, { datastreamId: dsid });
      return response;
    } catch(e) {
      console.log("Error " + e);
    }
  }

  getConfigValue(key:string) {
    switch(key) {
      case 'baseUrl':
        return this.baseURL;
      case 'apiUrl':
        return this.apiUrl;
      // TODO: return other configuration items for this RB server... 
    }
    return undefined;
  }

}
