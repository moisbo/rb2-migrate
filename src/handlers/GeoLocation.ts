// GrantBody handler

import {Handler, HandlerBase} from './handlers';


export class GeoLocation extends HandlerBase implements Handler {

	crosswalk(o: Object): Object | undefined {
		if( o['lat'] ) {
			return {
				'basic_name': o['rdf:PlainLiteral'],
				'lat': o['geo:lat'],
				'long': o['geo:long'],
				'identifier': o['dc:identifier']
			}
		} else {
			return {
				'basic_name': o['rdf:PlainLiteral']
			};
		}
	}

}
