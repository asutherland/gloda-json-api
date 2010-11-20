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

require.def("gloda-json-api/client/gloda",
  [
    "gloda-json-api/client/query",
    "exports"
  ],
  function(
    $query,
    exports
  ) {

var MARSHAL_HELPERS = {
  date: function(date) {
    if (date != null)
      return date.valueOf();
    return date;
  }
};

function Gloda(url, authkey) {
  this._url = url;
  this._authkey = authkey;
}
Gloda.prototype = {
  NOUN_CONVERSATION: "conversation",
  NOUN_MESSAGE: "message",
  NOUN_CONTACT: "contact",
  NOUN_IDENTITY: "identity",

  /**
   * Retrieved simplified schemas just for telling us what attributes exist
   *  and can be used for queries.  We use this to dynamically create the
   *  per-noun query prototypes.
   */
  _nounQuerySchemas: null,

  _nounQueryProtos: null,

  _makeQueryProtosFromQuerySchemas: function(querySchemas) {
    this._nounQuerySchemas = querySchemas;
    var queryProtos = this._nounQueryProtos = {};

    function makeProtoSimpleHelper(proto, attrKey) {
      proto[attrKey] = function() {
        this._constraints.push([attrKey,
                                Array.prototype.slice.call(arguments, 0)]);
      };
    }
    function makeProtoMarshalHelper(proto, attrKey, marshalFunc) {
      proto[attrKey] = function() {
        var transformed = [];
        for (var i = 0; i < arguments.length; i++) {
          transformed.push(marshalFunc(arguments[i]));
        }
        this._constraints.push([attrKey, transformed]);
      };
    }
    function makeProtoNestedMarshalHelper(proto, attrKey, marshalFunc) {
      proto[attrKey] = function() {
        var transformed = [];
        for (var i = 0; i < arguments.length; i++) {
          transformed.push(arguments[i].map(marshalFunc));
        }
        this._constraints.push([attrKey, transformed]);
      };
    }

    function idAttrFetcher(idAttr) {
      return function(obj) {
        return obj[idAttr];
      };
    }

    for (var nounType in querySchemas) {
      var schema = querySchemas[nounType];
      var proto = {
        __proto__: $query.BaseProxyQuery,
        _gloda: this,
        _nounType: nounType,
      };

      // query built-in funcs
      makeProtoSimpleHelper(proto, "limit");
      makeProtoSimpleHelper(proto, "orderBy");

      for (var attrKey in schema) {
        var attrDef = schema[attrKey];
        if (attrDef.selfMarshalling)
          makeProtoSimpleHelper(proto, attrKey);
        else if (attrDef.nounType in MARSHAL_HELPERS)
          makeProtoMarshalHelper(proto, attrKey,
                                 MARSHAL_HELPERS[attrDef.nounType]);
        else
          makeProtoMarshalHelper(proto, attrKey,
                                 idAttrFetcher(attrDef.idAttr));

        // *Range
        if (attrDef.continuous) {
          if (attrDef.nounType in MARSHAL_HELPERS)
            makeProtoNestedMarshalHelper(proto, attrKey + "Range",
                                         MARSHAL_HELPERS[attrDef.nounType]);
          else
            makeProtoSimpleHelper(proto, attrKey + "Range");

        }

        // *Like
        if (attrDef.likable) {
          makeProtoSimpleHelper(proto, attrKey + "Like");
        }
      }
      queryProtos[nounType] = proto;
    }
  },

  newQuery: function(nounName) {
    var query = {
      __proto__: this._nounQueryProtos[nounName],
      _constraints: [],
    };
    return query;
  },

  _doRemote: function(endpoint, reqObj, callback, errback) {
    var req = new XMLHttpRequest();
    req.open("POST", this._url + endpoint, true);
    req.addEventListener("load", function() {
      if (req.status == 200) {
        callback(JSON.parse(req.responseText));
      }
      else {
        console.error("error remoting to endpoint", endpoint, req.status, req);
        if (errback)
          errback(req);
      }
    }, false);
    req.send(JSON.stringify({authkey: this._authkey, request: reqObj}));
  }
};

exports.gimmeRemoteGloda = function(url, authkey, callback, errback) {
  var gloda = new Gloda(url, authkey);
  gloda._doRemote("schema", {}, function(result) {
    gloda._makeQueryProtosFromQuerySchemas(result);
    callback(gloda);
  }, errback);
};

});
