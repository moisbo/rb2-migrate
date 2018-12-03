
// Pluggable field handlers (see ./index.ts in this directory for
// more info)

import { LogCallback } from '../types';

export interface Handler {

	logger: LogCallback;
	config: Object; 

	// note: might need crosswalk to be async if it needs to do a lookup
	// somewhere

	crosswalk(orig: Object, mainObj?:any): Object|undefined; 

}

// 'config' is the clause invoking this handler in the crosswalk/recordType.json
// file, so that handlers can have parameters. For an example, see Person.ts

export abstract class HandlerBase {

	logger: LogCallback;
	config: Object; 
	mainConfig: any;
	rbDest: any;
	rbSource: any;

	constructor(l: LogCallback, c: Object, mConfig: any = undefined, rbSource: any = undefined, rbDest: any = undefined) {
		this.logger = l;
		this.config = c;
		this.mainConfig = mConfig;
		this.rbDest = rbDest;
		this.rbSource = rbSource;
	}

	abstract crosswalk(orig: object, mainObj?:any): Object;

}
