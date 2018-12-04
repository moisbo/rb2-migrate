// DataLocations handler

import {Handler, HandlerBase} from './handlers';

export class DataLocations extends HandlerBase implements Handler {

	crosswalk(o: Object): Object | undefined {

		let type = '';
		if (o['type']) {
			switch (o['type']) {
				case 'url':
					type = 'url';
					break;
				case '':
					type = 'physical';
					break;
				case 'file':
					type = 'file';
					break;
				case 'attachment':
					this.logger('handler', 'DataLocations', '', 'warning', 'No attachment step to do' + o['oid']);
					break;
				default:
					this.logger('handler', 'DataLocations', '', 'warning', 'No type found on ' + o['oid']);
			}
		}

		return Promise.resolve({
			'location': o['location'],
			'type': type,
			'notes': o['notes']
		});
	}

}
