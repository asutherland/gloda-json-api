/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at:
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Messaging Code.
 *
 * The Initial Developer of the Original Code is
 *   The Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Andrew Sutherland <asutherland@asutherland.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {Cc,Ci,Cr,Cu,components} = require("chrome");

var $gloda = {};
Cu.import("resource:///modules/gloda/public.js", $gloda);
var Gloda = $gloda.Gloda;

/**
 * Let's require whitelisting of nouns for now...
 */
var NOUN_MAP = {
  contact: Gloda.NOUN_CONTACT,
  identity: Gloda.NOUN_IDENTITY,
  conversation: Gloda.NOUN_CONVERSATION,
  message: Gloda.NOUN_MESSAGE,
};

/**
 * The noun ids for JavaScript primitives that are non-reference types, but
 *  might need a marshalling helper.
 */
var SIMPLE_NOUN_IDS_LIST = [
  Gloda.NOUN_BOOLEAN,
  Gloda.NOUN_NUMBER,
  Gloda.NOUN_STRING,
  // need MARSHAL_HELPERS:
  Gloda.NOUN_DATE,
];

var QUERY_SELF_MARSHALLING_IDS = SIMPLE_NOUN_IDS_LIST.concat([
  Gloda.NOUN_FULLTEXT,
]);

/**
 * The noun ids for attribute types that only exist to create query helpers and
 *  are never actually found as values on nouns.
 */
var QUERY_ONLY_NOUN_IDS_LIST = [
  Gloda.NOUN_FULLTEXT,
  // this is not really true, but it's too much of a complicating factor for
  //  now to bother with.
  Gloda.NOUN_PARAM_IDENTITY,
];

function cannedSchemaPrim(type) {
  return {
    reference: false,
    nounType: type,
    singular: true,
  };
}
var CANNED_SCHEMAS = {
  conversation: {
    subject: cannedSchemaPrim("string"),
  },
  tag: {
    key: cannedSchemaPrim("string"),
    tag: cannedSchemaPrim("string"),
  },
  folder: {
    id: cannedSchemaPrim("number"),
    name: cannedSchemaPrim("string"),
    accountLabel: cannedSchemaPrim("string"),
  },
};

// things that the datamodel exposes that are not defined as attributes that we
//  want to propagate
var SCHEMA_EXTRA_BITS = {
  message: {
    subject: cannedSchemaPrim("string"),
  },
  identity: {
    inAddressBook: cannedSchemaPrim("bool"),
  },
};

/**
 * Marshalling functions for noun types that lack attribute definitions and
 *  are not self-marshalling.
 */
var MARSHAL_HELPERS = {
  date: function(date) {
    return date.valueOf();
  },
  tag: function(tag) {
    return {
      key: item.key,
      tag: item.tag,
    };
  },
  /**
   * We really only want to expose a little bit of info about folders whereas
   *  the `GlodaFolder` representation is full of all kinds of implementation
   *  details.
   */
  folder: function(folder) {
    return {
      id: folder.id,
      name: folder.name,
      accountLabel: folder.accountLabel,
    };
  },
};

// on trunk protz has added GlodaAttachment which is a simple self-describing
//  type, albeit with getter junk so we need to use its toJSON impl on the
//  noun definition.
if ("NOUN_ATTACHMENT" in Gloda) {
  SIMPLE_NOUN_IDS_LIST.push(Gloda.NOUN_ATTACHMENT);
  MARSHAL_HELPERS["attachment-infos"] =
    Gloda._nounIDToDef[Gloda.NOUN_ATTACHMENT].toJSON;
}

/**
 * Serializes gloda object representations into JSON-able representations
 *  without duplication.  All references to other nouns (which might result
 *  in duplication in a naive implementation) are serialized as id-references
 *  with the actual objects stored in dictionaries.  Reconstruction is
 *  simplified by transmitting minimal schemas that that avoid the client API
 *  needing to know anything about the gloda schemas.
 *
 * @typedef[MarshalledGlodaSet @dict[
 *   @key[nounType String]{
 *     The noun type of the set.
 *   }
 *   @key[itemIds @listof["id" String]]{
 *     The ordered ids of the result set.
 *   }
 *   @key[nounSchemas @dictof[
 *     @key[nounType String]
 *     @value[nounSchema @dictof[
 *       @key[attrName String]
 *       @value[attrDesc @dict[
 *         @key[reference Boolean]{
 *           When true, indicates that we are marshalling the actual object in
 *           `nounValues` and just storing a reference or references to the
 *           noun values on this attribute.
 *         }
 *         @key[nounType String]{
 *           The type of noun this attribute references.  Use this to look up
 *           the actual noun instances in `nounValues`.
 *         }
 *         @key[singular Boolean]{
 *           Is this a singular value (true) or a list (false)?
 *         }
 *       ]]
 *     ]]{
 *       A simplified schema for the noun.  We describe all attributes that we
 *       put in the noun
 *     }
 *   ]]
 *   @key[nounValues @dictof[
 *     @key[nounType String]
 *     @value[values Object]
 *   ]]{
 *     Dictionaries containing the actual noun instances.
 *   }
 * ]]
 */
var Marshaller = {
  _makeSimpleSchema: function(nounDef) {
    if (nounDef.name in CANNED_SCHEMAS)
      return CANNED_SCHEMAS[nounDef.name];

    var schema = {};

    if (nounDef.name in SCHEMA_EXTRA_BITS) {
      for (var extraKey in SCHEMA_EXTRA_BITS[nounDef.name]) {
        schema[extraKey] = SCHEMA_EXTRA_BITS[nounDef.name][extraKey];
      }
    }

    for (var attrKey in nounDef.attribsByBoundName) {
      var attrDef = nounDef.attribsByBoundName[attrKey];

      // query-only types don't get marshalled
      if (QUERY_ONLY_NOUN_IDS_LIST.indexOf(attrDef.objectNoun) != -1)
        continue;

      // describe self-marshalling simple types
      if (SIMPLE_NOUN_IDS_LIST.indexOf(attrDef.objectNoun) != -1) {
        schema[attrDef.boundName] = {
          reference: false,
          nounType: attrDef.objectNounDef.name,
          singular: attrDef.singular,
        };
        continue;
      }

      // everything else must want to be a reference type
      schema[attrDef.boundName] = {
        reference: true,
        nounType: attrDef.objectNounDef.name,
        singular: attrDef.singular,
      };
    }

    return schema;
  },

  /**
   * Marshal a reference-type item into the outStruct.
   *
   * @args[
   *   @param[item GlodaNounInstance]
   *   @param[nounDef GlodaNounDef]{
   *     Item's noun definition.
   *   }
   *   @param[outStruct MarshalledGlodaSet]
   * ]
   * @return[]
   */
  _marshalItem: function(item, nounDef, outStruct) {
    // Initialize the nounDict and simpleSchema if they're not there yet.
    var nounDict, simpleSchema;
    if (!(nounDef.name in outStruct.nounValues)) {
      nounDict = outStruct.nounValues[nounDef.name] = {};
      simpleSchema = outStruct.nounSchemas[nounDef.name] =
                       this._makeSimpleSchema(nounDef);
    }
    else {
      nounDict = outStruct.nounValues[nounDef.name];
      simpleSchema = outStruct.nounSchemas[nounDef.name];
    }

    if (nounDef.name in MARSHAL_HELPERS) {
      nounDict[item[nounDef.idAttr]] = MARSHAL_HELPERS[nounDef.name](item);
      return;
    }

    // (put our result object in before populating it to avoid loopage.)
    var outObj = nounDict[item[nounDef.idAttr]] = {};

    // Propagate attributes based on the simple schema (=> ignore some stuff)
    for (var attrKey in simpleSchema) {
      var simpleDef = simpleSchema[attrKey];

      // non-reference types get copied or translated depending on helpers...
      if (!simpleDef.reference) {
        // helper! we need to translate...
        if (simpleDef.nounType in MARSHAL_HELPERS) {
          var helper = MARSHAL_HELPERS[simpleDef.nounType];
          if (simpleDef.singular)
            outObj[attrKey] = helper(item[attrKey]);
          else
            outObj[attrKey] = item[attrKey].map(helper);
        }
        // no helper! just copy, regardless of singularity; lists are json-safe.
        else {
          outObj[attrKey] = item[attrKey];
        }
        continue;
      }

      // no translation is required for missing/null attributes
      if (!(attrKey in item) || item[attrKey] == null) {
        if (simpleDef.singular)
          outObj[attrKey] = null;
        else
          outObj[attrKey] = [];
        continue;
      }

      var targetNounDef =
        Gloda._nounIDToDef[Gloda._nounNameToNounID[simpleDef.nounType]];
      var idAttr = targetNounDef.idAttr, id;
      if (!(simpleDef.nounType in outStruct.nounValues)) {
        outStruct.nounValues[simpleDef.nounType] = {};
        outStruct.nounSchemas[simpleDef.nounType] =
          this._makeSimpleSchema(targetNounDef);
      }
      var targetDict = outStruct.nounValues[simpleDef.nounType];
      if (simpleDef.singular) {
        var subitem = item[attrKey];
        id = subitem[idAttr];
        if (!(id in targetDict))
          this._marshalItem(subitem, targetNounDef, outStruct);
        outObj[attrKey] = id;
      }
      else {
        var subitems = item[attrKey];
        var outIds = outObj[attrKey] = [];
        for (var i = 0; i < subitems.length; i++) {
          var sub = subitems[i];
          id = sub[idAttr];
          if (!(id in targetDict))
            this._marshalItem(sub, targetNounDef, outStruct);
          outIds.push(id);
        }
      }
    }
  },

  /**
   * Marshall a list/set of Gloda items into our official marshalling format.
   *
   * @args[
   *   @param[items @listof[GlodaNounInstance]]
   *   @param[nounDef GlodaNounDef]
   * ]
   * @return[MarshalledGlodaSet]
   */
  marshalGlodaNounInstances: function(items, nounDef) {
    var itemIds = [];
    var outStruct = {
      nounType: nounDef.name,
      itemIds: itemIds,
      nounSchemas: {},
      nounValues: {},
    };

    var idAttr = nounDef.idAttr;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      this._marshalItem(item, nounDef, outStruct);
      itemIds.push(item[idAttr]);
    }

    return outStruct;
  }
};

function ResultListener(req, response) {
  this.req = req;
  this.response = response;
}
ResultListener.prototype = {
  onItemsAdded: function(items, collection) {
  },

  onItemsModified: function(items, collection) {
  },

  onItemsRemoved: function(items, collection) {
  },

  onQueryCompleted: function(collection) {
    console.log("query completed, trying to finish out response");
    var response = this.response;

    var outStruct = Marshaller.marshalGlodaNounInstances(
                      collection.items,
                      collection._nounDef);

    var respString = JSON.stringify(outStruct, null, 2);
    response.setStatusLine(this.req.httpVersion, 200, "OK");
    response.setHeader("Content-Type", "application/json", false);
    response.setHeader("Content-Length", respString.length.toString(),
                       false);
    response.write(respString);
    response.finish();
  }
};

function QueryHandler() {
}
QueryHandler.prototype = {
  handle: function(req, response) {
    if (!(req.noun in NOUN_MAP))
      throw new Error("Bad noun name!");

    console.log("query going async");

    // all gloda queries are async...
    response.processAsync();

    var query = Gloda.newQuery(NOUN_MAP[req.noun]);

    var constraints = req.constraints;
    for (var i = 0; i < constraints.length; i++) {
      query[constraints[i][0]].apply(query, constraints[i][1]);
    }

    var collection = query.getCollection(new ResultListener(req, response));
  },
};

exports.queryHandler = new QueryHandler();

/**
 * Return information about certain noun schemas for the purposes of being able
 *  to build proxied query objects.  Because our query instances have methods
 *  that are dynamically defined by the attributes and we do not want to
 *  depend on catch-all method invocation handlers (a mozilla only thing), we
 *  need to send the names of the attributes across the wire.  Additionally,
 *  types that require special marshalling need to be annotated so we know
 *  what/how to marshal them.
 */
exports.schemaFetchHandler = {
  _serializeNounAttrSchema: function(nounDef) {
    var outSchema = {};

    for (var attrKey in nounDef.attribsByBoundName) {
      var attrDef = nounDef.attribsByBoundName[attrKey];
      var attrNoun = attrDef.objectNounDef;

      var outAttr = outSchema[attrKey] = {
        nounType: attrNoun.name,
        selfMarshalling: QUERY_SELF_MARSHALLING_IDS.indexOf(attrNoun.id) != -1,
        continuous: attrNoun.continuous,
        likable: attrNoun.special === Gloda.kSpecialString,
      };

      if (!outAttr.selfMarshalling && ("idAttr" in attrNoun)) {
        outAttr.idAttr = attrNoun.idAttr;
      }
    }

    return outSchema;
  },

  handle: function(req, response) {
    var outSchemas = {};

    for (var nounName in NOUN_MAP) {
      var nounId = NOUN_MAP[nounName];
      var nounDef = Gloda._nounIDToDef[nounId];
      outSchemas[nounName] = this._serializeNounAttrSchema(nounDef);
    }

    return outSchemas;
  }
};
