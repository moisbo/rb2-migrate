/*
 *
 * Code for crosswalking data records
 */


// new rule: unflatten numeric keys automatically
// so field.n. -> field = [ 1, 2, ... ]
// and field.n.subfield -> field: [ { subfield: }, ... ]
//
// then crosswalk all fields into the new record unless they
// have an entry in the CROSSWALK dict: if they do, change
// fieldname

const fs = require('fs-extra');
const util = require('util');
const _ = require('lodash');

import {LogCallback} from './types';

import * as Handlers from './handlers/';


function get_handler(logger: LogCallback, spec: Object): Handlers.Handler | undefined {
	const className = spec['handler'];
	if (className in Handlers) {
		const cl = Handlers[className];
		var instance = new cl(logger, spec);
		return instance;
	} else {
		return undefined;
	}
}

// apply_handler - run a handler and if the result is undefined, replace it with
// {}

function apply_handler(h: Handlers.Handler, original: Object): Object {
	const out = h.crosswalk(original);
	if (_.isUndefined(out)) {
		return {};
	} else {
		return out;
	}
}

// repeat_handler - map a handler over multiple inputs and collapse any undefined
// results

function repeat_handler(h: Handlers.Handler, originals: Object[]): Object[] {
	console.log("repeat_handler: " + String(h));
	console.log("originals: " + JSON.stringify(originals));
	return originals.map((o) => h.crosswalk(o)).filter((o) => o)
}


export function crosswalk(cwjson: Object, original: any, logger: LogCallback): Object[] {
	var dest = {};
	const idfield = cwjson['idfield'];
	const oid = original[idfield];

	var src = unflatten(cwjson, original, logger);
	const unflat = {...src};

	const reqd = cwjson['required'];
	const cwspec = cwjson['fields'];
	const ignore = cwjson['ignore'];

	for (const srcfield in cwspec) {
		var destfield = trfield(cwspec[srcfield], srcfield);
		if (srcfield in src) {
			if (typeof(cwspec[srcfield]) === 'string') {
				dest[destfield] = src[srcfield];
				if (dest[destfield]) {
					logger('crosswalk', srcfield, destfield, "copied", dest[destfield]);
				} else {
					if (reqd.includes(destfield)) {
						logger('crosswalk', srcfield, destfield, "required", null);
					} else {
						logger('crosswalk', srcfield, destfield, "blank", null);
					}
				}
				delete src[srcfield];
			} else {
				const spec = cwspec[srcfield];
				if (spec["type"] === "valuemap") {
					dest[destfield] = valuemap(spec, srcfield, destfield, src[srcfield], logger);
					delete src[srcfield];
				} else if (spec["type"] === "record") {
					if ("handler" in spec) {
						// console.log("\n");
						// console.log(`Handler for field ${srcfield} => ${spec["name"]}`);
						// console.log(`Raw source: ${ JSON.stringify(src[srcfield]) }`);

						const h = get_handler(logger, spec);

						if (h) {
							console.log("Handler: " + spec['handler'] + ": " + srcfield);
							if (spec['repeatable']) {
								var srcf = src[srcfield];
								if( !Array.isArray(srcf) ) {
   								//console.log("repeatable handler array-ified");
									logger('crosswalk', srcfield, destfield, "warning: repeatable handler with non-array input", JSON.stringify(src[srcfield]));
									src[srcfield] = [ srcf ];
								}
								if (spec["changeDestination"]) {
									//console.log("changeDestination repeatable handler " + JSON.stringify(src[srcfield]));
									const repeatedHandler = repeat_handler(h, src[srcfield]);
									repeatedHandler.forEach(rH => {
										destfield = rH["destination"];
										if (rH["repeatable"]) {
											if (Array.isArray(dest[destfield])) {
												dest[destfield] = dest[destfield].concat(rH);
											} else {
												dest[destfield] = new Array(rH);
											}
										} else {
											dest[destfield] = rH;
										}
										delete rH["destination"];
										delete rH["repeatable"];
									});
								} else {
									//console.log("Repeatable handler " + JSON.stringify(src[srcfield]));
									dest[destfield] = repeat_handler(h, src[srcfield]);
								}
							} else {
								//console.log("Non-repeatable handler " + JSON.stringify(src[srcfield]));
								if( Array.isArray(src[srcfield]) ) {
									const first = src[srcfield][0]
									//console.log("Got array, picking first item");
									logger('crosswalk', srcfield, destfield, "selected first of multiple records", JSON.stringify(first));
									dest[destfield] = apply_handler(h, first);
								} else {
									dest[destfield] = apply_handler(h, src[srcfield]);
								}
							}
						} else {
							logger('crosswalk', srcfield, destfield, "error: handler", spec["handler"])
						}
					} else {
						logger('crosswalk', srcfield, destfield, "assuming processed", JSON.stringify(src[srcfield]));
						dest[destfield] = src[srcfield];
					}
					delete src[srcfield];
				} else {
					logger('crosswalk', srcfield, destfield, "error: type", spec["type"]);
				}
			}
		} else {
			if (reqd.includes(destfield)) {
				logger("crosswalk", srcfield, destfield, "required", null);
			} else {
				logger("crosswalk", srcfield, destfield, "missing", null);
			}
		}
	}
	for (const srcfield in src) {
		if (!ignore.includes(srcfield)) {
			logger("omitted", srcfield, "", "unmatched", src[srcfield]);
		} else {
			logger("omitted", srcfield, "", "ignored", src[srcfield]);
		}
  }
	return [unflat, dest];
}


/* unflatten - preprocessing pass which collects multiple records in the
   rb1.x "field.n." and "field.subfield" formats into proper JSON.

   gathers all of the crosswalk fields with type = "record" like so

   "outer:field.subfield:one": "value1",
   "outer:field.subfield:two": "value2", [..]

   "outer:field": {
       "subfield:one": "value1",
       "subfield:two": "value2",
       [..]
       }

   and

   "repeating:field.1.subfield:one": "value1a",
   "repeating:field.1.subfield:two": "value2a",
   "repeating:field.2.subfield:one": "value1b",
   "repeating:field.2.subfield:two": "value2b",

   "repeating:field": [
       {
           "subfield:one": "value1a",
           "subfield:two": "value2a"
       },
       {
           "subfield:one": "value1a",
           "subfield:two": "value2a"
       }
    ]

   and now (for repeatable fields without subfields)

   "repeating:singleton.1.throw:this.away": "value1",
   "repeating:singleton.2.throw:this.away": "value2",

   "repeating:singleton": {
       "subfield:one": "value1",
       "subfield:two": "value2",
       [..]
   }

  keys are remapped based on the fields{} dict in the crosswalk file


   Returns an object with the old record fields deleted and the new record
   fields added. Fields which aren't record fields are passed through to the
   output unchanged.


*/

function unflatten(cwjson: Object, original: Object, logger: LogCallback): Object {
	const repeatrecord = /^(\d+)\.?(.*)$/;

	var output = {...original};
	var rspecs = getrecordspecs(cwjson);
	for (const rfield in rspecs) {
		const spec = rspecs[rfield];
		const pattern = new RegExp('^' + rfield.replace('.', '\\.') + "\.(.*)$");
		for (const field in original) {
			const m = field.match(pattern);
			if (m) {
				// check to see if the field looks like a repeatable
				// record by matching on a leading (\d)\.
				var sfield = m[1];
				const m2 = sfield.match(repeatrecord);
				if (m2) {
					// don't skip this - filter later
					const i = parseInt(m2[1]) - 1;
					sfield = m2[2];
					if (!('fields' in spec)) {
						// no subfields
						if (!(rfield in output)) {
							output[rfield] = [];
						}
						logger("records", field, 'single', "copied", original[field]);
						output[rfield][i] = original[field];
						delete output[field];
					} else {
						if (!(sfield in spec['fields'])) {
							logger("records", field, "", "unknown subfield", sfield);
						} else {
							const mfield = spec['fields'][sfield];
							if (!(rfield in output)) {
								output[rfield] = [];
							}
							if (!(i in output[rfield])) {
								output[rfield][i] = {};
							}
							logger("records", field, mfield, "copied", original[field])
							output[rfield][i][mfield] = original[field];
							delete output[field];
						}
					}
				} else {
					// It doesn't look repeatable
					// the logic here should be made to match that of un-repeatable fields
					// ie accept what's in the document at this stage and complain when 
					// crosswalking
					// if (spec['repeatable']) {
					// 	logger("records", field, "", "should be repeatable", sfield);
					// } else {
					if (!(sfield in spec['fields'])) {
						logger("records", field, "", "unknown subfield", sfield);
					} else {
						const mfield = spec['fields'][sfield];
						if (!(rfield in output)) {
							output[rfield] = {};
						}
						logger("records", field, mfield, "copied", original[field])
						output[rfield][mfield] = original[field];
						delete output[field];
					}
				}
			}
		}
	}
	for (const rfield in output) {
		if (Array.isArray(output[rfield])) {
			// remove empty or blank list items
			output[rfield] = output[rfield].filter((x) => notempty(x));
		}
	}
	return output;
}


function notempty(x) {
	if (!x || x === "null") {
		return false;
	} else {
		return true;
	}
}


/* pulls all of the specifications for record fields from the
   crosswalk spec */

function getrecordspecs(cwjson: Object): Object {
	var rspecs = {};
	for (const field in cwjson['fields']) {
		if (cwjson['fields'][field]['type'] === 'record') {
			rspecs[field] = cwjson['fields'][field];
		}
	}
	return rspecs;
}


function trfield(cf: string, old: string): string {
	var f = cf;
	if (typeof(cf) !== "string") {
		f = cf['name'];
	}
	if (f === "_") {
		f = old.replace(/\./g, '_');
		return f;
	} else {
		return f;
	}
}

// check for a dc:identifier, ci and data manager (?)
// and for truthy values for everything in required
// this now returns an array of errors: if it's valid, returns an
// empty array - because I want all of the invalid errors to 
// appear in the index report

export function validate(owner: string, required: string[], js: Object, logger: LogCallback): string[] {

	const errors = [];

	const ci = js['contributor_ci'];

	if( !ci ) {
		logger('validate', '', 'contributor_ci', 'No CI', '');
		errors.push('No CI');
	} else {
		if( !ci['email'] ) {
			
			logger('validate', '', 'contributor_ci', 'CI without email: using owner', '');
			ci['email'] = owner;
		} else if( ci['email'] !== owner ) {
			logger('validate', '', 'ci', 'CI =/= record owner', '');
		}
	}

	const dm = js['contributor_data_manager'];

	if( !dm ) {
		logger('validate', '', 'contributor_data_manager', 'No data manager', '');
	} else {
		if( !dm['email'] ) {
			logger('validate', '', 'contributor_data_manager', 'DM without email', '');
		}
	}

	required.map((f) => {
		if( !js[f] ) {
			logger('validate', '', f, 'Required field is empty', '');
			errors.push(`Missing value for ${f}`);
		}
	});

	return errors;
}


// this is the first validate, and I really don't know what I was thinking

export function validate_old(required: string[], js: Object, logger: LogCallback): boolean {
	var r = _.clone(required);
	var ok = true;
	for (var key in js) {
		if (key.match(/\./)) {
			ok = false;
			logger("validate", "", key, "invalid character", ".");
		}
		_.pull(r, key);
	}
	if (r.length > 0) {
		r.map(rf => logger("validate", "", rf, "missing", ""));
		ok = false;
	}
	return ok;
}

function valuemap(spec: Object, srcfield: string, destfield: string, srcval: string, logger: LogCallback): string {
	if ("map" in spec) {
		if (srcval in spec["map"]) {
			logger("crosswalk", srcfield, destfield, "mapped", spec["map"][srcval]);
			return spec["map"][srcval];
		} else {
			logger("crosswalk", srcfield, destfield, "unmapped", srcval);
			return "";
		}
	}
	logger("crosswalk", srcfield, destfield, "no map!", srcval);
	return "";
}
