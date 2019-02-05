#!/bin/bash

OUTDIR=./output
SOURCE=Test1_9_files
DEST=Test2_0
CROSSWALK=$1

if [[ -z $CROSSWALK ]]; then
	echo "Give a crosswalk as the first argument, like:"
	echo "./run_migrate.sh dataset_live"
	exit 1
fi

node ./src/migrate.js --outdir $OUTDIR --source $SOURCE --dest $DEST --crosswalk $CROSSWALK  
