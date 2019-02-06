// GrantBody handler

import {Handler, HandlerBase} from './handlers';


export class GeoLocation extends HandlerBase implements Handler {

	crosswalk(o: Object): Object | undefined {

		return {
			'basic_name': o['rdf:PlainLiteral']
		};
	}

}
