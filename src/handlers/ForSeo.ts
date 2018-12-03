
import { Handler, HandlerBase } from './handlers';
import * as _ from 'lodash';

const FOR_SEO_RE = /http:\/\/purl.org\/asc\/1297.0\/2008\/(seo|for)\/(\d+)$/;
const FOR_SEO_DELIM = ' - ';

export class ForSeo extends HandlerBase implements Handler {

  crosswalk(o:Object, mainObj?:any): Object|undefined {
    if (this.config['useSubFields'] && mainObj) {
      let output = [];
      _.forOwn(o, (label, idx) => {
        const curObj = {label: label};
        _.forOwn(this.config['subFields'], (dest, src) => {
          if (dest == 'notation' && isNaN(_.get(mainObj, `${src}[${idx}]`))) {
            return;
          }
          _.set(curObj, dest, _.get(mainObj, `${src}[${idx}]`));
        });
        curObj['name'] = `${curObj['notation']} - ${curObj['label']}`;
        const genealogy = this.genealogy(curObj['notation']);
        if (!_.isEmpty(genealogy)) {
          curObj['genealogy'] = genealogy;
        }
        output.push(curObj);
      });
      output = _.sortBy(output, (o) => { return _.toInteger(o.notation) });
      return output;
    }
    const url = o['rdf:resource']; 
    const name = o['skos:prefLabel'];
    if( !url ) {
      this.logger("handler", "ForSeo", "", "Empty rdf:resource", "");
      return undefined;
    } 
    if( !name ) {
      this.logger("handler", "ForSeo", "", "Empty skos:prefLabel", "");
      return undefined;
    }
    const m = url.match(FOR_SEO_RE);
    if( m ) {
      const [ c1, l1 ] = name.split(FOR_SEO_DELIM);
      const output = {
        'rdf:resource': url,
        'type': m[1],
        'name': name,
        'label': l1,
        'notation': m[2],
        'genealogy': this.genealogy(m[2])
      };
      this.logger("handler", "for_seo", "", "succeeded", JSON.stringify(output));
      return output;
    } else {
      return { 'label': 'crossswalk error' };
    }
  }

// FOR or SEO code genealogy:
// '112233' -> [ '11', '1122' ] etc

  genealogy(code:string):string[] {
    var c = '';
    var g = [];
    for( var i = 0; i < code.length - 2; i += 2 ) {
      c += code.slice(i, i + 2);
      g.push(c);
    }
    return g;
  }
}





