/*
* Test: Get Record Metadata, list, info from redbox1
*       Use process.env.aRecord to grab a record from redbox1 to migrate.
* Author: Moises Sacal <moisbo@gmail.com>
*/

import {Redbox, Redbox1} from '../src/Redbox';
import * as path from 'path';
import * as fs from 'fs-extra';
import {expect} from 'chai';
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

describe('info  from redbox', () => {
	it('should return info from redbox1', async () => {
		const info = await rbSource.info();
		console.log(info);
		expect(info['code']).to.equal('200');
	});
});

describe('packages', () => {

	it('should return DMPTs from redbox1', async () => {
		const source_type = dmpt;
		const results = await rbSource.list(source_type);
		console.log(results);
		expect(results).to.not.equal(undefined);
	});

	it('should return dataset from redbox1', async () => {
		const source_type = dataset;
		const results = await rbSource.list(source_type);
		console.log(results);
		expect(results).to.not.equal(undefined);
	});

	it('should return selfSubmission from redbox1', async () => {
		const source_type = selfSubmission;
		const results = await rbSource.list(source_type);
		console.log(results);
		expect(results).to.not.equal(undefined);
	});

});


describe('dmp metadata', () => {

	const aRecord = process.env.aRecord;
	assert.notEqual(aRecord, undefined, 'Define a record <aRecord> with environment variable as process.env.aRecord');

	let cw;

	beforeEach(async () => {
		const cwf = path.join(config.get("crosswalks"), dmpt + '.json');
		cw = await fs.readJson(cwf);
	});

	it('should return metadata from record in redbox1', async () => {
		let md = await rbSource.getRecord(aRecord);
		const oid = md[cw['idfield']];
		console.log(md);
		expect(oid).to.not.equal(undefined);
	});

	it('should return objectmetadata from record in redbox1', async () => {
		let md = await rbSource.getRecordMetadata(aRecord);
		const oid = md[cw['idfield']];
		console.log(md);
		expect(oid).to.not.equal(undefined);
	})

});
