 /* http://stackoverflow.com/a/12019883/1763984
  *  
   var logger = require('./log');
   logger.info('log to file');

  */
var winston = require('winston');
var path = require('path');

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      json: false,
      timestamp: true
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, 'logs', 'debug.log'),
      json: false 
    })
  ],
  exceptionHandlers: [
    new (winston.transports.Console)({
      json: false,
      timestamp: true
    }),
    new winston.transports.File({
      filename: path.join(__dirname, 'logs', 'exceptions.log'),
      json: false
    })
  ],
  exitOnError: false
});

module.exports = logger;
