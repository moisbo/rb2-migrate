// FundingBody handler

import { Handler, HandlerBase } from './handlers';


export class FundingBody extends HandlerBase implements Handler {

  crosswalk(o:Object, mainObj?:any): Object|undefined {

    return {
    	'dc_title': o['dc_title'],
    	'dc_identifier': [ o ['dc_identifier'] ],
    	'ID': o['dc_title'],
    	'repository_name': [
    		'Funding Bodies'
    	]
    };
  }

}