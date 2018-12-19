import {Handler, HandlerBase} from './handlers';
import {isEmailValid, decodeEmail} from "../utils/helpers";

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

	crosswalk(o: Object): Object | undefined {
		const fullname = util.format("%s %s", o["givenname"].trim(), o["familyname"].trim());
		var honorific = o["honorific"].trim();
		if (honorific) {
			honorific = honorific + ' ';
		}
		let role = this.config["role"];
		let defaultRole = this.config["defaultRole"];
		let defaultField = this.config["defaultField"];
		let destination = '';
		let email = decodeEmail(o["email"]);
		let repeatable: boolean = false;
		email = isEmailValid(email) ? email : '';
		if (role === '') {
			const changeDest = this.config["destinations"].find(dest => {
				repeatable = dest['repeatable'];
				return o[dest['from']] === dest['value'];
			});
			if(changeDest) {
				role = changeDest['role'] || defaultRole;
				destination = changeDest['to'];
			}else {
				role = defaultRole;
				destination = defaultField;
			}
		}
		const output = {
			"dc:identifier": o["dc:identifier"],
			text_full_name: fullname,
			full_name_honorific: honorific + fullname,
			email: email,
			username: "",
			role: role,
			destination: destination,
			repeatable: repeatable
		};
		if (o["familyname"]) {
			this.logger('handler', "Person", role, "succeeded", JSON.stringify(output));
			if (!o["dc:identifier"]) {
				this.logger('handler', "Person", role, "warning", "No dc:identifier for " + fullname);
			}
			return output;
		} else {
			this.logger('handler', "Person", role, "missing", "No familyname for " + JSON.stringify(output));
		}
		return undefined;
	}
}


