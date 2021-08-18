function createPortSuite (lib) {
  var net = require('net'),
    q = lib.q,
    child_process = require('child_process'),
    isPipeTaken = require('allex_ispipetakenserverruntimelib')(lib),
    Path = require('path'),
    tmpPipeDir = require('allex_temppipedirserverruntimelib'),
    pipename = Path.join(tmpPipeDir(), 'allexportoffice');

  var _q = [],
    _currentDefer = null;


  function communicate(obj, defer) {
    defer = defer || q.defer();
    if (_currentDefer && _currentDefer!==defer) {
      _q.push([obj, defer]);
    } else {
      _currentDefer = defer;
      isPipeTaken(pipename).then(run.bind(null, obj, defer));
      defer.promise.then(do_q);
    }
    return defer.promise;
  }

  function do_q () {
    _currentDefer = null;
    var j = _q.pop();
    if (j) {
      communicate.apply(null, j);
    }
  }

  function run(obj, defer, sockettoprogram) {
    if (!sockettoprogram) {
      child_process.spawn('node',[Path.join(__dirname, 'portoffice.js')],{
        detached: true,
        stdio: 'inherit'
      });
      setTimeout(communicate.bind(null, obj, defer));
      return;
    }
    send(sockettoprogram, obj, defer);
  }

  function send(sockettoprogram, obj, defer){
    /*
    var c = new net.Socket();
    c.on('error', onSocketError.bind(null, obj, defer));
    c.on('data', onSocketData.bind(null, obj, defer));
    c.connect(pipename, function() {
      c.write(JSON.stringify(obj)+String.fromCharCode(0));
    });
    */
    sockettoprogram.on('error', onSocketError.bind(null, sockettoprogram, obj, defer));
    sockettoprogram.on('data', onSocketData.bind(null, sockettoprogram, obj, defer));
    sockettoprogram.write(JSON.stringify(obj)+String.fromCharCode(0));
  }

  function onSocketData(socket, obj, defer, data) {
    try {
      defer.resolve(JSON.parse(data.toString()));
    } catch (e) {
      defer.reject('communication error');
    }
    socket.removeAllListeners();
    socket.destroy();
  }

  function onSocketError (socket, obj, defer, error) {
    socket.removeAllListeners();
    socket.destroy();
    console.log('onSocketError', error);
    defer.reject(error);
  }

  function check(port, address, defer) {
    if (lib.isArray(port)) {
      return checkany(port);
    }
    return communicate({
      op: 'check',
      port: port,
      address: address || 'localhost'
    },defer);
  }

  function reserve(port, defer, maxport) {
    return communicate({
      op: 'reserve',
      port: port,
      maxport: maxport || port+1000
    },defer);
  }

  function release(port, defer) {
    return communicate({
      op: 'release',
      port: port
    },defer);
  }

  function onTestIfFree (portandipaddress, isfree) {
    return isfree ? portandipaddress : null;
  }
  function oneCheckerOfMany (portandipaddress) {
    var ret = check(portandipaddress.port, portandipaddress.ipaddress).then(onTestIfFree.bind(null, portandipaddress));
    portandipaddress = null;
    return ret;
  }

  function checkany (portandipaddresses) {
    if (!(lib.isArray(portandipaddresses) && portandipaddresses.length>0)) {
      return q([]);
    }
    return q.allSettled(portandipaddresses.map(oneCheckerOfMany)).then(
      function (states) {
        return states
          .filter(function (state) {return !!state && state.state == 'fulfilled' && state.value;})
          .map(function(state) {return state.value;});
      }
    );
  }

  return {
    check: check,
    reserve: reserve,
    release: release
  };
}

module.exports = createPortSuite;
