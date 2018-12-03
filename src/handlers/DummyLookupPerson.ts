import { LookupPerson } from './LookupPerson';
import * as _ from 'lodash';
// 

export class DummyLookupPerson extends LookupPerson  {

  async crosswalk(o: Object, mainObj?:any) {
    const walked = await super.crosswalk(o, mainObj);
    if (_.isArray(walked)) {
        _.each(walked, (w) => { this.insertDummys(w, mainObj)});
    } else {
        this.insertDummys(walked, mainObj);
    }
    return walked;
  }

  insertDummys(o, mainObj) {
    if (_.isEmpty(o['given_name']) || _.isUndefined(o['given_name'])) {
        o['given_name'] = "John";
        o['family_name'] = "Doe";
        o["text_full_name"] = `${o['given_name']} ${o['family_name']}`
        o["full_name_honorific"] = `${o['given_name']} ${o['family_name']}`
        o["full_name_family_name_first"] = `${o['family_name']}, ${o['given_name']}`
    }
    if (_.isEmpty(o['email']) || _.isUndefined(o['email'])) {
        o['email'] = `${o['given_name']}.${o['family_name']}@redboxresearchdata.com.au`;
    }
  }
}


