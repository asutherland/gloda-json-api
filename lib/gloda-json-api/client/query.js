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

require.def("gloda-json-api/client/query",
  [
    "exports"
  ],
  function(
    exports
  ) {

var Unmarshaller = {
  /**
   * Non-mutating unmarshaling
   */
  _unmarshal: function(id, marshalled, nounType, inStruct, outDicts) {
    var outObj = outDicts[nounType][id] = {};
    var schema = inStruct.nounSchemas[nounType];
    for (var attrKey in schema) {
      if (!schema.reference) {
        if (schema.singular)
          outObj[attrKey] = marshalled[attrKey];
        else
          outObj[attrKey] = marshalled[attrKey].concat();
      }
      else {
        var subid, subschema = inStruct.nounSchemas[schema.nounType];
        var subdict = inStruct.nounValues[subschema.nounType];
        if (schema.singular) {
          subid = marshalled[attrKey];
          if (!(subid in outDicts[subschema.nounType]))
            this._unmarshal(subid, subdict[subid], subschema.nounType,
                            inStruct, outDicts);
          outObj[attrKey] = outDicts[subschema.nounType][subid];
        }
        else {
          var subout = outObj[attrKey] = [], subin = marshalled[attrKey];
          for (var i = 0; i < subin.length; i++) {
            subid = subin[i];
            if (!(subid in outDicts[subschema.nounType]))
              this._unmarshal(subid, subdict[subid], subschema.nounType,
                              inStruct, outDicts);
            subout.push(outDicts[subschema.nounType][subid]);
          }
        }
      }
    }
  },

  unmarshalGlodaNounInstances: function(marshalledSet) {
    var outList = [], inItems = marshalledSet.itemIds, outDicts = {};
    var nounType;

    // intialize all out dictionaries
    for (nounType in marshalledSet.nounValues)
      outDicts[nounType] = {};

    nounType = marshalledSet.nounType;
    var schema = marshalledSet.nounSchemas[nounType],
        inDict = marshalledSet.nounValues[nounType],
        outDict = outDicts[nounType] = {};

    for (var i = 0; i < inItems.length; i++) {
      if (!(inItems[i] in outDict))
        this._unmarshal(inDict[inItems[i]], nounType, marshalledSet, outDicts);
      outList.push(outDict[inItems[i]]);
    }

    return outList;
  },
};

function ProxiedCollection(listener, marshalledSet) {
  this.items = Unmarshaller.unmarshalGlodaNounInstances(marshalledSet);
  this.listener.onItemsAdded(this.items, this);
  this.listener.onQueryCompleted(this);
}
ProxiedCollection.prototype = {
};

var BaseProxyQuery = {
  getCollection: function(listener) {
    var queryPayload = {
      noun: this._nounType,
    };

    this._gloda._doRemote("query", queryPayload, function(result) {
      new ProxiedCollection(listener, JSON.parse(req.responseText));
    });
  },
};
exports.BaseProxyQuery = BaseProxyQuery;

}); // end require.def
