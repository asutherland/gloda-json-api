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

/**
 * Spin up a localhost-only server with our endpoints bound.
 **/

const {Cc,Ci,Cr,Cu,components} = require("chrome");

const PORT = 8778;

var $httpd = require("gloda-json-api/opc/httpd");
$httpd.setDebug(false);

var file = require("file");

var $query = require("gloda-json-api/server/query");

function fabServer(port) {
  var server = new $httpd.nsHttpServer();
  server.start(port);
  return server;
}

function grabEnvVar(name) {
  var env = Cc["@mozilla.org/process/environment;1"]
              .getService(Ci.nsIEnvironment);
  if (env.exists(name))
    return env.get(name);
  return null;
}

var authWrappingHandler = {
  endpoints: {
    query: $query.queryHandler,
    schema: $query.schemaFetchHandler,
  },

  _authkey: null,
  authCheck: function(req) {
    if (!("authkey" in req) || typeof(req.authkey) !== "string")
      return false;

    if (this._authkey === null) {
      var path = file.join(grabEnvVar("HOME"), ".tbauthkey");
      if (!file.exists(path))
        return false;
      this._authkey = file.read(path).trim();
    }

    return req.authkey === this._authkey;
  },

  handle: function(request, response) {
    console.log("handling", request.method, "request for", request.path);

    if (request.method !== "POST") {
      throw new $httpd.HttpError(405, "POST!");
    }

    var reqData = JSON.parse(request.readBody());


    if (!this.authCheck(reqData)) {
      throw new $httpd.HttpError(401, "APO");
    }

    var desiredEndpoint = request.path.substring(1);
    if (!(desiredEndpoint in this.endpoints))
      throw new $httpd.HttpError(404, "What?");

    var respData = this.endpoints[desiredEndpoint].handle(reqData.request,
                                                          response);

    // If anything is returned, assume it's synchronous town...
    if (respData) {
      var respString = JSON.stringify(respData, null, 2);
      response.setStatusLine(request.httpVersion, 200, "OK");
      response.setHeader("Content-Type", "application/json", false);
      response.setHeader("Content-Length", respString.length.toString(),
                         false);
      response.write(respString);
    }
  },

  registerHandlers: function(server) {
    for (var key in this.endpoints) {
      server.registerPathHandler("/" + key, this);
    };
  },
};

exports.main = function main(options, callbacks) {
  var server = fabServer(PORT);
  authWrappingHandler.registerHandlers(server);
};
