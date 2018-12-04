/*
* Test: Test your crosswalk
*       Use process.env.aRecord to grab a record from redbox1 to migrate.
* Author: Moises Sacal <moisbo@gmail.com>
*/

import { Redbox1 } from '../src/Redbox';
import {crosswalk} from '../src/crosswalk';
import * as path from 'path';
import * as fs from 'fs-extra';
import { expect } from 'chai';
import * as assert from 'assert';

import 'mocha';

const config = require('config');
const source = 'redbox1';
const server = source;
const cf = config.get('servers.' + server);

const dmpt = process.env.rdmpt || 'dmpt';
const dataset = process.env.dataset || 'dataset';
const selfSubmission = process.env.selfSubmission || 'self-submission';

const rbSource = new Redbox1(cf);

describe('dmpt crosswalk metadata', () => {

	const aRecord = process.env.aRecord;
	assert.notEqual(aRecord, undefined, 'Define a record <aRecord> with environment variable as process.env.aRecord');

	let cw;
	let md;

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
		const oid = md[cw['idfield']];
	});


	it('should crosswalk', () => {
		const res = crosswalk(cw, md, logger);
		const mdu = res[0];
		const md2 = res[0];
		expect(md2).to.not.equal(undefined);
	});

});

describe('dataset crosswalk metadata', () => {

	const aRecord = process.env.aRecord;
	assert.notEqual(aRecord, undefined, 'Define a record <aRecord> with environment variable as process.env.aRecord');

	let cw;
	let md;

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
		const oid = md[cw['idfield']];
	});


	it('should crosswalk', async () => {
		const res = await crosswalk(cw, md, logger);
		const mdu = res[0];
		const md2 = res[1];
		expect(md2).to.not.equal(undefined);
	});

});
