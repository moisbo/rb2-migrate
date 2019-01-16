
// A class which connects to a ReDBox instance via its API
// Uses the axios module to do the https connection


import axios from 'axios';
import { AxiosInstance } from 'axios';
const qs = require('qs');
const util = require('util');

/**
    Class for working with the ReDBox APIs
*/


/* common interface for RB 1.x and 2.0 */

export interface Redbox {

  baseURL: string;
  apiKey: string;
  version: string;

  progress: ((message: string) => void)|undefined;

  setProgress(pf: (message: string) => void): void;

  info(): Promise<Object>;
  list(ptype: string, start?:number, limit?:number ): Promise<string[]>;
  createRecord(metadata: Object, packagetype: string, options?: Object): Promise<string|undefined>;
  // deleteRecord(oid: string): Promise<bool>;
  getRecord(oid: string): Promise<Object|undefined>;
  getRecordMetadata(oid: string): Promise<Object|undefined>;
  updateRecordMetadata(oid: string, metadata: Object): Promise<Object|undefined>;
  getPermissions(oid: string): Promise<Object|undefined>;
  grantPermission(oid: string, permission: string, users:Object): Promise<Object|undefined>;
  removePermission(oid: string, permission: string, users:Object): Promise<Object|undefined>;
  getConfigValue(key: string): string;
  getNumRecords(ptype?: string): Promise<number>;
}


/* base class with the axios http methods and progress indicator */

export abstract class BaseRedbox {

  baseURL: string;
  apiKey: string;
  version: string;

  ai: AxiosInstance;
  progress: ((message: string) => void)|undefined;


  constructor(cf: Object) {
    this.baseURL = cf['baseURL'];
    this.apiKey = cf['apiKey'];
    this.progress = undefined;
  }

  /* this is separate so Redbox2 can hack baseURL */

  /* using a custom serialiser because axios' default
     URL-encodes the solr query string for search */

  initApiClient() {
    this.ai = axios.create({
      baseURL: this.baseURL,
      headers: {
        "Authorization": "Bearer " + this.apiKey,
	      "Content-Type": "application/json"
      },
      paramsSerializer: function(params) {
	      return qs.stringify(params, { encode: false });
      }
    });
  }

  // set a progress hook which will get called with messages
  // by "long" operations like list - this is used for the
  // cli-spinner in migrate.ts

  setProgress(pf: (message: string) => void): void {
    this.progress = pf;
  }

  removeprogress():void {
    this.progress = undefined;
  }

  /* low-level method which is used by all the GET requests */

  async apiget(path: string, params?: Object): Promise<Object|undefined> {
    let url = path;
    if( url[0] !== '/' ) {
      url = '/' + url;
    }
    try {
      let config = {};
      if( params ) {
        config["params"] = params;
      }
      let response = await this.ai.get(url, config);
      if( response.status === 200 ) {
        return response.data;
      }
    } catch ( e ) {
      return undefined;
    }
  }

  /* low-level method used by POST requests */

  async apipost(path: string, payload: Object, params?: Object): Promise<Object|undefined> {
    let url = path;
    let config = {};
    if( url[0] !== '/' ) {
      url = '/' + url;
    }
    try {
      if( params ) {
        config["params"] = params;
      }
      console.log("POST " + url);
      console.log("config " + JSON.stringify(config));
      console.log("payload " + JSON.stringify(payload).slice(0, 80));
      let response = await this.ai.post(url, payload, config);
      if( response.status >= 200 && response.status < 300 ) {
        return response.data;
      }
    } catch ( e ) {
      console.trace("\n\nPost error " + String(e));
      console.log("URL: " + url);
      console.log("payload: " + JSON.stringify(payload).slice(0, 40));
      console.log("config:" + JSON.stringify(config));
      return undefined;
    }
  }


	/* low-level method used by POST requests */

	async apiput(path: string, payload: Object, params?: Object): Promise<Object|undefined> {
		let url = path;
		let config = {};
		if( url[0] !== '/' ) {
			url = '/' + url;
		}
		try {
			if( params ) {
				config["params"] = params;
			}
			let response = await this.ai.put(url, payload, config);
			if( response.status >= 200 && response.status < 300 ) {
				return response.data;
			}
		} catch ( e ) {
			console.trace("\n\nPut error " + String(e));
			console.log("URL: " + url);
			console.log("payload: " + JSON.stringify(payload).slice(0, 40));
			console.log("config:" + JSON.stringify(config));
			return undefined;
		}
	}

// see https://github.com/axios/axios/issues/897#issuecomment-343715381
// on axios' support for adding a body to a delete request, which
// it does a bit differently than with a post

  async apidelete(path: string, payload?: Object): Promise<Object> {
    let url = path;
    if( url[0] !== '/' ) {
      url = '/' + url;
    }
    try {
      if( payload ) {
        let response = await this.ai.delete(url, { data: payload });
        if( response.status >= 200 && response.status < 300 ) {
          return response.data;
        }
      } else {
        let response = await this.ai.delete(url);
        if( response.status >= 200 && response.status < 300 ) {
          return response.data;
        }
      }
    } catch ( e ) {
      console.log("Delete error " + String(e));
      console.log("URL: " + url);
      return undefined;
    }

  }

  getConfigValue(key:string) {
    switch(key) {
      case 'baseUrl':
        return this.baseURL;
        // TODO: return other configuration items for this RB server... 
    }
    return undefined;
  }
}
