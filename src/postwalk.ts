const _ = require('lodash');

export function postwalk(tasks, recordMeta, logger) {
  logger("postwalk", '', '', 'debug', JSON.stringify(tasks));
	tasks.forEach((task) => {
		console.log("Running postwalk for " + JSON.stringify(task));
		recordMeta = methods[task['name']](task['fields'], recordMeta, logger)
	});

	return recordMeta;
}


const methods = {
	complement: (fields, recordMeta, logger) => {
		fields.forEach(field => {
			recordMeta[field['updateTo']] = recordMeta[field['name']];
		});
		return recordMeta;
	},
	removeIfRepeated: (fields, recordMeta, logger) => {
		fields.forEach(field => {
			const index = _.findIndex(recordMeta[field['removeFrom']], (rM) => {
				return rM[field['compare']] === recordMeta[field['name']][field['compare']];
			});
			if (index >= 0) {
				recordMeta[field['removeFrom']].splice(index, 1);
			}
		});

		return recordMeta;
	}
};
