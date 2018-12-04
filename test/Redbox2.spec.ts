/*
* Test: Inject 1 object into redbox 2 using crosswalk and redbox1
*       Use process.env.aRecord to grab a record from redbox1 to migrate.
* Author: Moises Sacal <moisbo@gmail.com>
*/

import {Redbox1, Redbox2} from '../src/Redbox';
import * as path from 'path';
import * as fs from 'fs-extra';
import {expect} from 'chai';
import * as assert from 'assert';

import 'mocha';
import {crosswalk} from "../src/crosswalk";


const config = require('config');
const source = 'redbox1';
const server = source;
const cf = config.get('servers.' + server);

const dmpt = process.env.rdmpt || 'dmpt';
const dataset = process.env.dataset || 'dataset';
const dataRecord = process.env.selfSubmission || 'dataRecord';
const rdmp = process.env.rdmp || 'rdmp';

const rbSource = new Redbox1(cf);

const server2 = 'redbox2';
const cf2 = config.get('servers.' + server2);
const rbDest = new Redbox2(cf2);


describe('info from redbox', () => {
	it('should return info from redbox destination', async () => {
		const infoDest = await rbDest.info();
		//There is no info api return yet!
		expect(infoDest);
	});
});

describe('insert dmpt into rb2:rdmp', () => {

	const aRecord = process.env.aRecord;
	assert.notEqual(aRecord, undefined, 'Define a record <aRecord> with environment variable as process.env.aRecord');

	let cw: any;
	let md: any;
	let res: any;
	let mdu: any;
	let md2: any;

	let report = [ [ 'oid', 'stage', 'ofield', 'nfield', 'status', 'value' ] ];
	const logger = ( stage, ofield, nfield, msg, value ) => {
		report.push([aRecord, stage, ofield, nfield, msg, value]);
	};

	beforeEach(async () => {
		const cwf = path.join(config.get("crosswalks"), dmpt + '.json');
		cw = await fs.readJson(cwf);
		assert.notEqual(cw, undefined, 'could not crosswalk from file');
		md = await rbSource.getRecord(aRecord);
		assert.notEqual(md, undefined, 'could not getRecord from rbSource');
		res = await crosswalk(cw, md, logger, rbSource, rbDest);
		mdu = res[0];
		md2 = res[1];
		assert.notEqual(mdu, undefined, 'could not unflatten crosswalk from rbSource');
		assert.notEqual(md2, undefined, 'could not crosswalk from rbSource');
	});


	it('should insert rdmp record', async () => {
		const dest_type = rdmp;
		const noid = await rbDest.createRecord(md2, dest_type);
		console.log(noid);
		expect(noid).to.not.equal(undefined);

	});

});


describe('insert dataset into rb2', () => {

	const aRecord = process.env.aRecord;
	assert.notEqual(aRecord, undefined, 'Define a record <aRecord> with environment variable as process.env.aRecord');

	let cw: any;
	let md: any;
	let res: any;
	let mdu: any;
	let md2: any;

	let report = [ [ 'oid', 'stage', 'ofield', 'nfield', 'status', 'value' ] ];
	const logger = ( stage, ofield, nfield, msg, value ) => {
		report.push([aRecord, stage, ofield, nfield, msg, value]);
	};

	beforeEach(async () => {
		const cwf = path.join(config.get("crosswalks"), dataset + '.json');
		cw = await fs.readJson(cwf);
		assert.notEqual(cw, undefined, 'could not crosswalk from file');
		md = await rbSource.getRecord(aRecord);
		assert.notEqual(md, undefined, 'could not getRecord from rbSource');
		res = await crosswalk(cw, md, logger, rbSource, rbDest);
		mdu = res[0];
		md2 = res[1];
		assert.notEqual(mdu, undefined, 'could not unflatten crosswalk from rbSource');
		assert.notEqual(md2, undefined, 'could not crosswalk from rbSource');
	});


	it('should insert record', async () => {
		const dest_type = dataRecord;
		const noid = await rbDest.createRecord(md2, dest_type);
		expect(noid).to.not.equal(undefined);
	});

});
