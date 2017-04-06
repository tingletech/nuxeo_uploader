'use strict';
var fs = require('fs');
var Promise = require("bluebird");
var pfa = require("bluebird").promisifyAll;
var path = require('path');
var os = require('os');
var _ = require('underscore');


/*
 * get nuxeo status and run callback(true|false)
 */
module.exports.nx_status = function nx_status(nuxeo, token, cb){
  if (! token) { return cb(false); }
  nuxeo.connect()
    .then(function(client){
      return cb(true);
    })
    .catch(function(error) {
      return cb(false);
    });
}


/*
 * list children files of a remote path
 */
module.exports.nxls = function nxls(nuxeo, path, formatter, postfix='/@children'){
  // check path specific path
  const check_url = 'path' + path;
  // check the path for childern by default, but allow postfix override
  const url = check_url.replace(/\/$/, '') + postfix;
  nuxeo.request(url)
    .get()
    .bind(path)
    .then(function(remote) {
        formatter(remote, path);
    })
    .catch(function(error){
      console.log(error.response || error);
      throw error;
    });
};


/*
 * run whole batch of files
 */
module.exports.runBatch = function runBatch(client, emitter, collection, nuxeo_directory, concurrent) {
  // Sometimes we might want to run a limited number of tasks in parallel.
  // http://spion.github.io/promise-nuggets/16-map-limit.html cc0
  var queue = [];

  var uploadPromises = collection.map(function(fileModel, index) {
    // How many items must download before fetching the next?
    // The queued, minus those running in parallel, plus one of the parallel slots.
    var mustComplete = Math.max(0, queue.length - concurrent + 1);
    // when enough items are complete, queue another request for an item
    var upload = Promise.some(queue, mustComplete)
      .then(function() {
        return module.exports.runOne(client, emitter, fileModel, index, nuxeo_directory);
      });
    queue.push(upload);
    return upload.then(function(item) {
      return item;
    });
  });
  Promise.settle(uploadPromises).then(function(uploads) {
    emitter.emit('batchFinished');
    console.log(uploads);
  });
};



/*
 * run one file (return Promise)
 */
module.exports.runOne = function runOne(client, emitter, fileModel, index, nuxeo_directory) {
  var uploader = client.operation('FileManager.Import')
    .context({ currentDocument: nuxeo_directory })
    .uploader({
      // convert callbacks to events
      uploadStartedCallback: function(fileIndex, file) {
        emitter.emit('uploadStarted', index, file)
      },
      uploadFinishedCallback: function(fileIndex, file, time) {
        emitter.emit('uploadFinished', index, file, time)
      },
      uploadProgressUpdatedCallback: function(fileIndex, file, newProgress) {
        emitter.emit('uploadProgressUpdated', index, file, newProgress)
      },
      uploadSpeedUpdatedCallback: function(fileIndex, file, speed) {
        emitter.emit('uploadSpeedUpdated', index, file, speed)
      }
  });

  var filePath = fileModel.get('path');
  var stats = fs.statSync(filePath);
  var rfile = fileModel.get('file');

  return new Promise(function(resolve, reject){
    uploader.uploadFile(rfile, function(fileIndex, file, timeDiff) {
      uploader.execute({
        path: path.basename(filePath)
      }, function (error, data) {
        if (error) {
          fileModel.set('state', 'error');
          emitter.emit('uploadError', error, fileModel, data)
          reject(error, fileModel, data);
        } else {
          fileModel.set('state', 'success');
          emitter.emit('uploadOk', data)
          resolve(data);
        }
      });
    });
  });
}


/*
 * return URL to get auth token from Nuxeo server.
 */
module.exports.get_auth_token_link = function get_auth_token_link() {
  return 'authentication/token' +
         '?applicationName='    + encodeURIComponent("CDL Nuxeo Client") +
         '&deviceId='           + encodeURIComponent(os.hostname()) +
         '&deviceDescription='  + encodeURIComponent("") +
         '&permission=rw';
}


/*
Copyright © 2017, Regents of the University of California
All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
 * Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.
 * Neither the name of the University of California nor the names
   of its contributors may be used to endorse or promote products
   derived from this software without specific prior written
   permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
*/
