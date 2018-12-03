import { Handler, HandlerBase } from './handlers';
import * as _ from 'lodash';
import * as humanname from 'humanname';
import * as parseDomain from 'parse-domain';

const util = require('util');

// 

export class LookupPerson extends HandlerBase implements Handler {

  async crosswalk(o: Object, mainObj?:any) {
    const role = this.config["role"];
    
    if (_.isArray(o)) {
      if (!this.config["array"]) {
        return this.lookup(o[0], role, mainObj);
      }
      const lookupData = [];
      for (var i=0; i<_.size(o); i++) {
        lookupData.push(await this.lookup(o[i], role, mainObj));
      }
      return lookupData;
    } else {
      return this.lookup(o, role, mainObj);
    }
  }

  async lookup(o: any, role: any, mainObj:any) {
    const lookupData = await this.rbSource.getRecord(o);
    const output = {role: role, username: "", email: ""};
    if (!_.isUndefined(lookupData) && !_.isEmpty(lookupData)) {
      const fullName = lookupData['title'];
      output['full_name_honorific'] = fullName;
      output['text_full_name'] = fullName;
      const parsed = humanname.parse(fullName);
      output['given_name'] = parsed['firstName'];
      output['family_name'] = parsed['lastName'];
      output['honorific'] = parsed['salutation'];
      output['full_name_family_name_first'] = `${output['family_name']}, ${output['given_name']}`;   
      output['email'] = parsed['email'];
      if (_.isEmpty(output['email']) || _.isUndefined(output['email'])) {
        const domainParsed = parseDomain(mainObj['data_source_key'])
        if (!_.isNull(domainParsed) && !_.isUndefined(domainParsed)) {
          output['email'] = `${output['given_name']}.${output['family_name']}@${domainParsed.domain}.${domainParsed.tld}`;
        }
      }
      return output;
    }
    this.logger('handler', "Person", role, "missing", `Failed to lookup data for id: ${o}`);
    return output;
  }
}


