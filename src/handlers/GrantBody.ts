// GrantBody handler

import {Handler, HandlerBase} from './handlers';


export class GrantBody extends HandlerBase implements Handler {

	async crosswalk(o: Object, mainObj?:any) {

		return Promise.resolve({
			'dc_title': o['dc_title'],
			'dc_identifier': [o ['dc_identifier']],
			'grant_number': o['grant_number'],
			'repository_name': [
				'Research Activities'
			]
		});
	}

}
