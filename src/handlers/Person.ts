import { Handler, HandlerBase } from './handlers';

const util = require('util');

// This expects the incoming person record to have the following:

// dc:identifier
// familyname
// givenname
// honorific
// email

// Use the 'fields' clause in the crosswalk JSON file to map the
// fields in your rb1.x records to the above keys: this will be
// done before the Person handler is used to crosswalk the
// records.

export class Person extends HandlerBase implements Handler {

  crosswalk(o: Object, mainObj?:any): Object|undefined {
    const fullname = util.format("%s %s", o["givenname"].trim(), o["familyname"].trim());
    var honorific = o["honorific"].trim();
    if( honorific ) {
      honorific = honorific + ' ';
    }
    const role = this.config["role"];
    const output = {
      "dc:identifier": o["dc:identifier"],
      text_full_name: fullname,
      full_name_honorific: honorific + fullname,
      email: o["email"],
      username: "",
      role: role
    };
    if( o["familyname"] ) {
      this.logger('handler', "Person", role, "succeeded", JSON.stringify(output));
      if( !o["dc:identifier"] ) {
        this.logger('handler', "Person", role, "warning", "No dc:identifier for " + fullname);
      }
      return output;
    } else {
      this.logger('handler', "Person", role, "missing", "No familyname for " + JSON.stringify(output));
    }
    return undefined;
  }
}


