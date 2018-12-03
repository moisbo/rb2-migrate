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

import { LogCallback } from './types';

import * as Handlers from './handlers/';



function get_handler(logger:LogCallback, spec:Object, masterConfig:any = undefined, rbSource: any = undefined, rbDest: any = undefined): Handlers.Handler|undefined {
  const className = spec['handler'];
  if( className in Handlers ) {
    const cl = Handlers[className];
    var instance = new cl(logger, spec, masterConfig, rbSource, rbDest);
    return instance;
  } else {
    return undefined;
  }
}

// apply_handler - run a handler and if the result is undefined, replace it with
// {}

async function apply_handler(h: Handlers.Handler, original:Object, mainObj?:any) {
  const out = await h.crosswalk(original, mainObj);
  if( _.isUndefined(out) ) {
    return {};
  } else {
    return out;
  }
}

// repeat_handler - map a handler over multiple inputs and collapse any undefined
// results

async function repeat_handler(h: Handlers.Handler, originals: Object[], mainObj?:any) {
  return originals.map( async (o) => await h.crosswalk(o, mainObj)).filter((o) => o)
}



export async function crosswalk(cwjson: Object, original: any, logger: LogCallback, rbSource: any = undefined, rbDest: any = undefined) {
  var dest = {};
  const idfield = cwjson['idfield'];
  const oid = original[idfield];

  var src = unflatten(cwjson, original, logger);
  const unflat = {... src};

  const reqd = cwjson['required'];
  const cwspec = cwjson['fields'];
  const ignore = cwjson['ignore'];

  for( const srcfield in cwspec ) {
    var destfield = trfield(cwspec[srcfield], srcfield);
    // changed to lodash's way of accessing objects using complex paths
    if( !_.isUndefined(_.get(src, srcfield)) ) {
      if( typeof(cwspec[srcfield]) === 'string' ) {
        _.set(dest, destfield, _.get(src, srcfield));
        if( dest[destfield] ) {
          logger('crosswalk', srcfield, destfield, "copied", dest[destfield]);
        } else {
          if( reqd.includes(destfield) ) {
            logger('crosswalk', srcfield, destfield, "required", null);
          } else {
            logger('crosswalk', srcfield, destfield, "blank", null);
          }
        }
        delete src[srcfield];
      } else {
        const spec = cwspec[srcfield];
        if( spec["type"] === "valuemap" ) {
          dest[destfield] = valuemap(spec, srcfield, destfield, src[srcfield], logger);
          delete src[srcfield];
        } else if( spec["type"] === "record" ) {
          if( "handler" in spec ) {
            const h = get_handler(logger, spec, cwjson, rbSource, rbDest);
            if( h ) {
              if( spec['repeatable'] ) {
                if( Array.isArray(src[srcfield]) ) {
                  dest[destfield] = await repeat_handler(h, src[srcfield], src);
                } else {
                  logger('crosswalk', srcfield, destfield, "error: repeatable handler with non-array input", JSON.stringify(src[srcfield]));
                  dest[destfield] = [];
                }
              } else {
                dest[destfield] = await apply_handler(h, src[srcfield], src);
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
      const spec = cwspec[srcfield];
      if (!_.isEmpty(spec['default'])  && !_.isUndefined(spec['default'])) {
        _.set(dest, destfield, spec['default']);
      }
      if( reqd.includes(destfield) ) {
        logger("crosswalk", srcfield, destfield, "required", null);
      } else {
        logger("crosswalk", srcfield, destfield, "missing", null);
      }
    }
  }
  for( const srcfield in src ) {
    if( !ignore.includes(srcfield) ) {
      logger("postwalk", srcfield, "", "unmatched", src[srcfield]);
    } else {
      logger("postwalk", srcfield, "", "ignored", src[srcfield]);
    }
  }

  return [ unflat, dest ];
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

  var output = {... original};
  var rspecs = getrecordspecs(cwjson);
  for( const rfield in rspecs ) {
    const spec = rspecs[rfield];
    const pattern = new RegExp('^' + rfield.replace('.', '\\.') + "\.(.*)$");
    for( const field in original ) {
      const m = field.match(pattern);
      if( m ) {
        // check to see if the field looks like a repeatable
        // record by matching on a leading (\d)\.
        var sfield = m[1];
        const m2 = sfield.match(repeatrecord);
        if( m2 ) {
          if( ! spec['repeatable'] ) {
            logger("records", field, "", "not repeatable", sfield);
          } else {
            const i = parseInt(m2[1]) - 1;
            sfield = m2[2];
            if( !('fields' in spec) ) {
              // no subfields
              if( !(rfield in output) ) {
                output[rfield] = [];
              }
              logger("records", field, 'single', "copied", original[field]);
              output[rfield][i] = original[field];
              delete output[field];
            } else {
              if( !(sfield in spec['fields']) ) {
                logger("records", field, "", "unknown subfield", sfield);
              } else {
                const mfield = spec['fields'][sfield];
                if( !(rfield in output) ) {
                  output[rfield] = [];
                }
                if( !(i in output[rfield]) ) {
                  output[rfield][i] = {};
                }
                logger("records", field, mfield, "copied", original[field])
                output[rfield][i][mfield] = original[field];
                delete output[field];
              }
            }
          }
        } else {
          // It doesn't look repeatable
          if( spec['repeatable'] ) {
            logger("records", field, "", "should be repeatable", sfield);
          } else {
            if( !(sfield in spec['fields']) ) {
              logger("records", field, "", "unknown subfield", sfield);
            } else {
              const mfield = spec['fields'][sfield];
              if( !(rfield in output) ) {
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
  }
  for( const rfield in output ) {
    if( Array.isArray(output[rfield]) ) {
      // remove empty or blank list items
      output[rfield] = output[rfield].filter((x) => notempty(x));
    }
  }
  return output;
}


function notempty(x) {
  if( !x || x === "null" ) {
    return false;
  } else {
    return true;
 }
}





/* pulls all of the specifications for record fields from the
   crosswalk spec */

function getrecordspecs(cwjson: Object): Object {
  var rspecs = {};
  for( const field in cwjson['fields'] ) {
    if( cwjson['fields'][field]['type'] === 'record' ) {
      rspecs[field] = cwjson['fields'][field];
    }
  }
  return rspecs;
}



function trfield(cf: string, old: string): string {
  var f = cf;
  if( typeof(cf) !== "string" ) {
    f = cf['name'];
  }
  if( f === "_" ) {
    f = old.replace(/\./g, '_');
    return f;
  } else {
    return f;
  }
}

export function validate(required: string[], js: Object, logger:LogCallback): boolean {
  var r = _.clone(required);
  var ok = true;
  for( var key in js ) {
    if( key.match(/\./) ) {
      ok = false;
      logger("validate", "", key, "invalid character", ".");
    }
    _.pull(r, key);
  }
  if( r.length > 0 ) {
    r.map(rf => logger("validate", "", rf, "missing", ""));
    ok = false;
  }
  return ok;
}



function valuemap(spec: Object, srcfield: string, destfield: string, srcval: string, logger: LogCallback): string {
  if( "map" in spec ) {
    if( srcval in spec["map"] ) {
      logger("crosswalk", srcfield, destfield, "mapped", spec["map"][srcval]);
      return spec["map"][srcval];
    } else {
      logger("crosswalk", srcfield, destfield, "unmapped", srcval);
      return spec["default"] ? spec["default"] : "";
    }
  }
  logger("crosswalk", srcfield, destfield, "no map!", srcval);
  return "";
}
