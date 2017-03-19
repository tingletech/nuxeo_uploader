'use strict';
var path = require('path');
var EventEmitter = require('events').EventEmitter;
// var Promise = require('bluebird');
var filesize = require('filesize');
var url = require('url');
// var gui = require('nw.gui');
var nuxeoupload = require('../src/nuxeoupload.js');
// var logger = require('../src/logs.js');
// nuxeo = Promise.promisifyAll(nuxeo);

var Nuxeo = require('nuxeo');


console.log('hey, running!');

/**
 * backbone / marionette / epoxy application
 */
var NuxeoUploadApp = new Backbone.Marionette.Application();

NuxeoUploadApp.on("start", function(options){
  // logger.info('application starting');


  /*
   * model and view for summary area
   */
  var SummaryModel = Backbone.Model.extend({
    defaults: {
      selected: 0,
      waiting: 0,
      uploading: 0,
      success: 0,
      error: 0
    }
  });
  var summaryModel = new SummaryModel();
  var SummaryView = Backbone.Epoxy.View.extend({
    el: '#summary',
    bindings: {
      'div#selected': 'text:selected',
      'div#waiting': 'text:waiting',
      'div#uploading': 'text:uploading',
      'div#success': 'text:success',
      'div#error': 'text:error'
    }
  });
  var summaryView = new SummaryView({model: summaryModel});


  /*
   * model and view for configuration object
   */
  var ConfigModel = Backbone.Model.extend({
    localStorage: new Backbone.LocalStorage("nuxeo_uploader_config"),
    defaults: {
      nuxeoServer: 'https://nuxeo.cdlib.org/nuxeo',
      nuxeoToken: '',
      pathFilter: '/asset-library/',
      skipReupload: true,
      id: 'config'
    },
    nuxeoBase: function nuxeoBase(){
      return this.get("nuxeoServer")
                 .replace(new RegExp("^https://(.*)\.cdlib\.org/nuxeo"),
                          "https://$1.cdlib.org/Nuxeo");
    }
  });
  var configModel = new ConfigModel();
  var ConfigView = Backbone.Epoxy.View.extend({
    el: ".nuxeo-config",
    bindings: {
      "input#nuxeo_server": "value:nuxeoServer,events:['keyup']",
      "input#nuxeo_token": "value:nuxeoToken,events:['keyup']",
      "input#path_filter": "value:pathFilter,events:['keyup']",
      "input#skip_reupload": "checked:skipReupload"
      // broke --> #auth_token_link bound in HTML data-bind="attr:{href:authTokenLink}
    },
    initialize: function() {
      this.model.fetch();
    },
    events: {
      "keyup #nuxeo_server": "onAdd",
      "keyup #nuxeo_token": "onAdd",
      "keyup #path_filter": "onAdd",
      "change #skip_reupload": "onAdd"
    },
    onAdd: function(e){
      this.model.save({id: 'config'});
    }
  });
  var configView = new ConfigView({model: configModel});


 /*
  *  set up Models and Views remote folder
  */
  // set up nuxeo client connection (now that we have config)
  var client = new Nuxeo({
    baseURL: configModel.nuxeoBase(),
    auth: { method: 'token' },
    headers: { 'X-Authentication-Token': configModel.get('nuxeoToken') },
    timeout: 2995000
  });
  var NuxeoFolderCollection = Backbone.Collection.extend({
    model: Backbone.Model
  });
  var NuxeoFolderCollectionView = Backbone.Epoxy.View.extend({
    el: "#select_nuxeo", // binding in HTML
    initialize: function(client) {
      this.collection = new NuxeoFolderCollection();
      var that = this;
      var path = $('#path_filter').val();
      var re = new RegExp('^' + path);
      if (configModel.get('nuxeoToken')) {
        nuxeoupload.writable_folderish(client, path)
          .then(function(folders) {
            that.collection.reset(_.map(folders, function(x) {
              return { label: x.replace(re, ''),
                       value: x };
            }));
          });
      }
    }
  });
  var folderView = new NuxeoFolderCollectionView(client);


  /*
   *  set up Models and Views for file processing
   */
  var classMap = {
    selected: '',
    waiting: 'info',
    uploading: '',
    success: 'success',
    error: 'danger'
  }
  var FileModel = Backbone.Epoxy.Model.extend({
    defaults: {
      state: 'selected'
    },
    initialize: function(item) {
      this.set('file', item);
      this.set('lastModifiedDate', item.lastModifiedDate.toJSON());
      this.set('size', filesize(item.size));
    },
    computeds: {
      cssClass: function() {
        var state = this.get('state');
        return classMap[state];
      },
      at: function() {
        return 'i' + fileListView.collection.length;
      }
    }
  });
  // set up a cell class for each column
  var progressbar = '<td><div class="progress">' +
        '<div class="progress-bar size" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"> </div>' +
      '</div></td>';
  var cols = ['state', 'filename', 'lastmodified'];
  var tmpl = _.template("<td class='<%= css %>'></td>");
  cols = cols.map(function(x) {
    return tmpl({css: x});
  });
  var FileView = Backbone.Epoxy.View.extend({
    tagName: 'tr',
    el: '<tr>' + cols.join() + progressbar + '</tr>',
    bindings: {
      ':el': 'attr:{class:cssClass}',
      'div.progress-bar': 'attr:{id:at}',
      '.state': 'text:state',
      '.lastmodified': 'text:lastModifiedDate',
      '.filename': 'text:name',
      '.size': 'text:size'
    }
  });
  var FileCollection = Backbone.Collection.extend({
    model: FileModel
  });
  var FileListView = Backbone.Epoxy.View.extend({
    el: '#local',
    itemView: FileView,
    initialize: function(){
      this.collection = new FileCollection();
      return this;
    },
    addFiles: function(e) {
      this.counter = 0;
      var that = this;
      _(e).each(function(item){
        that.counter++;
        var file = new FileModel(item);
        // file.set(item);
        that.collection.add(file);
      });
      summaryModel.set('selected', this.counter);
    },
  });
  var fileListView = new FileListView();


  /**
   *  Interactions / jQuery / emitters / callbacks that change HTML
   */
  var emitter = new EventEmitter();


  /* 'canStartYet' events fire on certain user interactions to
     trigger this check of the interface state so the `btn-primary` class
     can be moved around the input elements
  */
  emitter.on('canStartYet', function(e) {
    // if we are ready to upload
    if ($('input[type=file]')[0].files.length > 0
        &&
        $('#select_nuxeo select').val() !== ''
    ) {
    // make upload the primary action
      $('#upload').addClass('btn-primary');
      $('#upload').removeClass('disabled');
    } else {
      $('#upload').removeClass('btn-primary');
      $('#upload').addClass('disabled');
    }
    // if selecting files is the only thing left to do
    if ($('input[type=file]')[0].files.length > 0
        &&
        $('#select_nuxeo select').val() === ''
    ) {
    // make selecting files the primary action
      $('#select_nuxeo').addClass('btn-primary');
    } else {
      $('#select_nuxeo').removeClass('btn-primary');
    }
  });

  emitter.on('batchStarted', function(batchId) { });
  emitter.on('batchFinished', function(batchId) {
    console.log('batch finished');
    $('#upload').removeClass('btn-primary');
    new Notification("Batch finished");
  });
  emitter.on('uploadStarted', function(fileIndex, file) {
    fileListView.collection.findWhere({path: file.path}).set('state', 'uploading');
    var waiting = summaryModel.get('waiting');
    var uploading = summaryModel.get('uploading');
    summaryModel.set('waiting', waiting - 1)
    summaryModel.set('uploading', uploading + 1)
  });
  emitter.on('uploadFinished', function(fileIndex, file, time) {
    var uploading = summaryModel.get('uploading') - 1;
    var success = summaryModel.get('success') + 1;
    var total = summaryModel.get('selected');
    var newProgress = Math.round(success / total * 100);
    var newText = success + ' / ' + total + '  ' + newProgress + '%';
    summaryModel.set('uploading', uploading);
    summaryModel.set('success', success);
    fileListView.collection.findWhere({path: file.path}).set('state', 'success');
    $('#overall')
      .css('width', newProgress + '%')
      .attr('aria-valuenow', newProgress)
      .html(newText);
  });
  emitter.on('uploadError', function(error, fileModel, data) {
    var success = summaryModel.get('success');
    var errors = summaryModel.get('error');
    summaryModel.set('success', success - 1);
    summaryModel.set('error', errors + 1);
    console.log(error, fileModel, data);
  });
  emitter.on('uploadProgressUpdated', function(fileIndex, file, newProgress){
    // console.log('uploadProgressUpdated', fileIndex, file, newProgress);
    $('#i' + fileIndex)
      .css('width', newProgress + '%')
      .attr('aria-valuenow', newProgress)
      .html(filesize(file.size) + ' ' + newProgress + '%');
  });
  emitter.on('uploadSpeedUpdated', function(fileIndex, file, speed){
    // console.log('uploadSpeedUpdated', fileIndex, file, speed);
  });


  /*
   *  configuration / get token after shibboleth
   */
  // poor man's data binding, look up value on click
  $('#auth_token_link').on('click', function(event, baseURL) {
    // open a window that is big enough for shibboleth
/*
    var new_win = gui.Window.open(
      url.resolve(
        $('#nuxeo_server').val().replace(/\/$/, ""),
        ['nuxeo', nuxeoupload.get_auth_token_link()].join('/')
      )
    );
*/
  });


  /*
   *  Select files for upload
   */
  // detect when user has selected files http://stackoverflow.com/a/12102992
  var input = $('input[type=file]');
  input.click(function () { this.value = null; });
  input.on('change', function () {
    emitter.emit('canStartYet');
    fileListView.addFiles(this.files);
    this.disabled = true;
    $(this).addClass('btn-default').removeClass('btn-primary');
  });


  /*
   * select directory to upload to
   */
  $('#select_nuxeo select').on('change', function () {
    emitter.emit('canStartYet');
  });


  /*
   *  nx_status fires callback(true|false) with connection status
   */
  nuxeoupload.nx_status( client, Boolean(configModel.get('nuxeoToken')), function(it_is_up) {
    if (it_is_up) {
      $('#nx_status')
        .addClass('glyphicon glyphicon-link text-success')
        .html('ok');
      // enable selection when connection is set up
      $('#select_nuxeo').removeClass('disabled');
      $('input[type=file]').removeClass('disabled');
      // won't need the auth token link again
      $('#auth_token_link').hide('');
    } else {
      $('#nx_status')
         .addClass('glyphicon glyphicon-remove text-danger')
        .html('not connected');
    }
  });


  /*
   *  Upload files
   */
  $('#upload').click(function () {
    var nuxeo_directory = $('#select_nuxeo select').val();
    var concurrent = 3;
    $(this).button('loading');
    emitter.emit('upload triggered', fileListView);
    $('#select_nuxeo').addClass('disabled');
    fileListView.collection.each(function(fileModel) {
      fileModel.set('state', 'waiting');
    });
    summaryModel.set('waiting', fileListView.collection.length);
    nuxeoupload.runBatch(client, emitter, fileListView.collection, nuxeo_directory, concurrent);
  });
});

NuxeoUploadApp.start();

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
