#!/usr/bin/env node

var net = require('net'),
  fs = require('fs'),
  lib = require('allexlib'),
  q = lib.q,
  Path = require('path'),
  tempPipeDir = require('allex_temppipedirserverruntimelib'),
  pipename = Path.join(tempPipeDir(), 'allexportoffice'),
  isPipeTaken = require('allex_ispipetakenserverruntimelib')(lib),
  _q = [],
  _currentDefer = null,
  _reservations = new lib.Map(),
  _portstounreserve = [],
  sec = 1000,
  minute = 60 * sec;

function checkReservations() {
  _portstounreserve.forEach(function(r){
    _reservations.remove(r);
  });
  _portstounreserve.splice(0);
  if (!_reservations.count) {
    lib.runNext(checkReservations, 10 * sec);
    return;
  }
  _reservations.traverse(checkReservation);
  lib.runNext(checkReservations, minute);
}

function checkReservation(r, port) {
  if (Date.now() -r < 3 * minute) {
    return;
  }
  _portstounreserve.push(port);
}

checkReservations();

isPipeTaken(pipename).then(run, process.exit.bind(process,1));


function isPortFree(port, ipaddress){
  if(!port){
    var e = new Error('Invalid port specified for test');
    e.code = 'INVALID_PORT';
    e.ipaddress = ipaddress;
    e.port = port;
    return q.reject(e);
  }
  if(!ipaddress){
    ipaddress = 'localhost';
  }
  if (ipaddress === 'localhost' && _reservations.get(port)){
    var d = q.defer();
    setTimeout(d.resolve.bind(d,false),10);
    return d.promise;
  } else {
    var pcj = new PortCheckJob(ipaddress, port);
    pcj.go();
    return pcj.defer.promise;
  }
}
function onIsPortFree (port, address, defer, maxport, minport, result) {
  if(result){
    _reservations.add(port, Date.now());
    defer.resolve(port)
  }else{
    port = port+1;
    if(port >= maxport){
      port = minport;
    }
    firstFreePortStartingWith(port,address,defer,maxport);
  }
}
function firstFreePortStartingWith(port,address,defer,maxport){
  defer = defer || q.defer();
  maxport = maxport || port+1000;
  if(!(port && 'number' === typeof port && port>0 && port<32768)){
    var e = new Error('Invalid port specified for test');
    e.code = 'INVALID_PORT';
    e.ipaddress = ipaddress;
    e.port = port;
    defer.reject(e);
  }
  isPortFree(port,address).done(
    //d.resolve.bind(d),
    onIsPortFree.bind(null, port, address, defer, maxport, port)
  );
  return defer.promise;
}




function Job() {
  this.defer = q.defer();
  this.result = null;
  this.error = null;
}
Job.prototype.destroy = function () {
  if (this.defer) {
    if (this.error) {
      this.defer.reject(this.processDeferParam(this.error));
    } else {
      this.defer.resolve(this.processDeferParam(this.result));
    }
  }
  this.error = null;
  this.result = null;
  this.defer = null;
};
Job.prototype.processDeferParam = function (thingy) {
  return JSON.stringify(thingy);
};
Job.prototype.success = function (result) {
  this.result = result;
  this.destroy();
};
Job.prototype.fail = function (error) {
  this.error = error;
  this.destroy();
};

function PortCheckJob(ipaddress, port) {
  Job.call(this);
  this.ipaddress = ipaddress;
  this.port = port;
  this.errorer = this.success.bind(this, true);
  this.socket = new net.Socket();
  this.socket.on('error',this.errorer);
  this.socket.on('close',this.errorer);
  this.timeout = null;
}
lib.inherit(PortCheckJob, Job);
PortCheckJob.prototype.destroy = function () {
  if (this.timeout) {
    lib.clearTimeout(this.timeout);
  }
  this.timeout = null;
  if (this.socket) {
    this.socket.removeAllListeners();
    this.socket.destroy();
  }
  this.socket = null;
  this.errorer = null;
  this.port = null;
  this.ipaddress = null;
  Job.prototype.destroy.call(this);
};
PortCheckJob.prototype.processDeferParam = function (thingy) {
  return thingy;
};
PortCheckJob.prototype.go = function () {
  //console.log('testing', this.ipaddress+':'+this.port);
  this.socket.connect(this.port,this.ipaddress,this.success.bind(this,false));
  this.timeout = lib.runNext(this.errorer, sec);
};
PortCheckJob.prototype.success = function (result) {
  //console.log(result ? 'free': 'taken');
  try {
  Job.prototype.success.call(this, result);
  } catch(e) {
    console.error(e.stack);
    console.error(e);
  }
};


function ReserveJob(prophash) {
  Job.call(this);
  this.port = prophash.port;
  this.maxport = prophash.maxport;
}
lib.inherit(ReserveJob, Job);
ReserveJob.prototype.destroy = function () {
  this.maxport = null;
  this.port = null;
  Job.prototype.destroy.call(this);
};
ReserveJob.prototype.go = function () {
  firstFreePortStartingWith(this.port, 'localhost').done(
    this.success.bind(this),
    this.fail.bind(this) //won't happen
  );
};

function ReleaseJob(prophash) {
  Job.call(this);
  this.port = prophash.port;
}
lib.inherit(ReleaseJob, Job);
ReleaseJob.prototype.destroy = function () {
  this.port = null;
  Job.prototype.destroy.call(this);
};
ReleaseJob.prototype.go = function () {
  _reservations.remove(this.port);
  this.success(this.port);
};

function CheckJob(prophash) {
  Job.call(this);
  this.address = prophash.address || 'localhost';
  this.port = prophash.port;
}
lib.inherit(CheckJob, Job);
CheckJob.prototype.destroy = function () {
  this.port = null;
  this.address = null;
  Job.prototype.destroy.call(this);
};
CheckJob.prototype.go = function () {
  isPortFree(this.port, this.address).done(
    this.success.bind(this),
    this.fail.bind(this)
  );
};


function doProcess(job) {
  if (_currentDefer) {
    _q.push(job);
  } else {
    _currentDefer = job.defer;
    _currentDefer.promise.done(do_q);
    job.go();
  }
}

function do_q () {
  _currentDefer = null;
  var j = _q.pop();
  if(j){
    doProcess(j);
  }
}

//Connectivity
function connectionHandler(c) {
  new ConnectionHandler(c);
}

function run(taken){
  if(taken) {
    taken.destroy();
    process.exit(2);
    return;
  }
  var s = net.createServer(connectionHandler);
  s.on('error',process.exit.bind(process,4));
  s.listen(pipename, function(e){
    if (e) {
      console.log('server start problem',e);
      process.exit(3);
    }
  });
}

function ConnectionHandler(socket) {
  this.socket = socket;
  this.message = '';
  socket.on('close', this.destroy.bind(this));
  socket.on('error', this.destroy.bind(this));
  socket.on('data', this.onData.bind(this));
}
ConnectionHandler.prototype.destroy = function () {
  this.socket.removeAllListeners();
  this.socket.destroy();
  this.message = null;
  this.socket = null;
};
function zeroPos(buffer){
  var ret = 0;
  while (ret < buffer.length){
    if(buffer[ret] === 0){
      return ret;
    }
    ret ++;
  }
  return ret;
}
ConnectionHandler.prototype.onData = function (data) {
  var zeropos = zeroPos(data);
  this.message += data.toString('utf8', 0, zeropos);
  if (zeropos < data.length) {
    this.run();
  }
};
ConnectionHandler.prototype.onJobDone = function (result) {
  if (this.socket) {
    this.socket.end(result);
  }
};
ConnectionHandler.prototype.run = function () {
  try {
    var j;
    this.message = JSON.parse(this.message);
    switch(this.message.op){
      case 'reserve':
        j = new ReserveJob(this.message);
        break;
      case 'release':
        j = new ReleaseJob(this.message);
        break;
      case 'check':
        j = new CheckJob(this.message);
        break;
    }
    if (!j) {
      this.socket.end();
    } else {
      j.defer.promise.then(this.onJobDone.bind(this));
      doProcess(j);
    }
  } catch (e) {
    this.socket.end();
  }
};
//end of Connectivity


