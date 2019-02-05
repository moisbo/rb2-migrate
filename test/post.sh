#!/bin/bash

#ENDPOINT=https://test-redbox.research.uts.edu.au/redbox/api/v1
#APIKEY=29us0fw984yrw9
#PTYPE=dmpt

OID=42914baa3b2269c8c91f968604d97392

JSONFILE=dataset_live.json

ENDPOINT=http://localhost:1500/default/rdmp/api/records

APIKEY="ed74bc5a-59ab-4090-99c1-a51e23f1c5cc"
PTYPE=dataRecord
MIMETYPE="Content-Type: application/json"

curl -X POST "$ENDPOINT/metadata/$PTYPE" -d @$JSONFILE -H "Authorization: Bearer $APIKEY" -H "$MIMETYPE"


# curl -X GET "$ENDPOINT/info" $HEADERS


#curl -v -X GET "$ENDPOINT/metadata/$OID" -H "Authorization: Bearer $APIKEY" -H "$MIMETYPE"

#curl -v -X GET "$ENDPOINT/permissions/$OID" -H "Authorization: Bearer $APIKEY" -H "$MIMETYPE"

