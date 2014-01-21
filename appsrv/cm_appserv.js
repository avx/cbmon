/* 
 * run as: node cm_appserv.js
 */

/* Asterisk AMI connection */
var AMI_HOST = '127.0.0.1';
var AMI_PORT = 5038;
var AMI_USER = 'aster';
var AMI_PASS = 'flomaster';

require ("./js.js");

var net = require('net');
var http = require("http");

var client = new net.Socket();
var connected = 0;
var timestamp = '';

var confs=[];
var members=new Object();
var dur=new Object();

client.on('error', function(err) {
    console.log(err);
    process.exit(1);
});

client.on('close', function() {
    console.log('Connection closed');
});

client.connect(AMI_PORT, AMI_HOST, function() {
    console.log('CONNECTED TO: ' + AMI_HOST + ':' + AMI_PORT);
    client.write('Action: Login\r\nUsername: '+AMI_USER+'\r\nSecret: '+AMI_PASS+'\r\n\r\n');
});

var Data='';
client.on('data', function(data) {
//    console.log("VVVVVVVVVVVVVVVVVVVVVVV\n"+data+"^^^^^^^^^^^^^^^^^^^^^^^^\n");
    Data=Data+data;

    var empty=Data.search(/Response: Error\r\nMessage: No active conferences./);
    if (empty>0) {
	Data=Data.slice(empty+50);
	members=new Object();
	confs=[];
    }

    while (1) {
	var pA=Data.search(/EventList: start\r\n/);
	if (pA<0) break;
	else {
	    Data=Data.slice(pA);
	    var pB=Data.search(/EventList: Complete\r\n/)
	    if (pB<0) break;
	    else {
		var resp=Data.slice(0,pB);
		parse(resp);
		Data=Data.slice(pB);
	    }
	}
    }
});

function parse(data) {
    var confs_tmp=[];
    var dur_tmp=new Object();
//    console.log("WWWWWWWWWWWWWWWWWWWWWW\n"+data+"MMMMMMMMMMMMMMMMMMMMMMM\n");

    var par=data.split('\r\n\r\n');
    var members_list=[];

    for (var i in par) {

	/* CONFBRIDGELISTROOMS */
        if (par[i].match(/Event: ConfbridgeListRooms\r\n/)) {
            res=par[i].match(/Conference: (\d+)\r\nParties: (\d+)\r\nMarked: (\d+)\r\nLocked: ([YN])/);
            var conf=new Object();
            if (res) {
        	conf['conf']=res[1];
                conf['members']=res[2];
                conf['marked']=res[3];
                conf['locked']=(res[4]=='Y'?1:0);
                confs_tmp.push(conf);
            }
	}
	if (par[i].match(/Event: ConfbridgeListRoomsComplete/)) {
//	    console.log(members);
//	    console.log(confs_tmp);

	    for (var k in members) {
		var del=1
		for (var l in confs_tmp) {
		    if (confs_tmp[l]['conf']==k)
			del=0;
		}
		if (del==1)
		    delete members[k];
	    }
	    confs=confs_tmp;
	    delete confs_tmp;
	}
	/* END OF CONFBRIDGELISTROOMS */

	/* CONFBRIDGELIST(CONF) */
        if (par[i].match(/Event: ConfbridgeList\r\n/)) {
	        res=par[i].match(/Conference: (\d+)\r\nCallerIDNum: (\d+)\r\nCallerIDName: ([^\r]+)\r\nChannel: ([^\r]+)\r\nAdmin: ([^\r]+)\r\nMarkedUser: ([^\r]+)\r\nTalking: (\d)\r\nMuted: (\d)/);
                if (res) {
                    var member=new Object();
                    member['conf']=res[1];
                    member['cid']=res[2];
                    member['cidname']=res[3];
                    member['channel']=res[4];
                    member['admin']=(res[5]=='Yes'?1:0);
                    member['marked']=(res[6]=='Yes'?1:0);
                    member['talking']=(res[7]=='1'?1:0);
                    member['muted']=(res[8]=='1'?1:0);
		    member['dur']=dur[res[4]];
		    members_list.push(member);
		}
	}
	if (par[i].match(/Event: ConfbridgeListComplete/)) {
	    members[res[1]]=members_list;
	}
	/* END OF CONFBRIDGELIST(CONF) */

	/* CORESHOWCHANNELS */
        if (par[i].match(/Event: CoreShowChannel\r\n/)) {
		res=par[i].match(/Channel: ([^\r]+)\r\n/);
		if (res) {
		    var chan=res[1];
		    res=par[i].match(/Duration: ([^\r]+)\r\n/);
		    if (res) {
			dur_tmp[chan]=res[1];
		    }
		}
	}
	if (par[i].match(/Event: CoreShowChannels/)) {
	    dur=dur_tmp;
	    delete dur_tmp;
	}
	/* END OF CORESHOWCHANNELS */
    }
}


function memberlist() {
//    console.log("memberslist()");
    if (confs.length>0) {
	client.write('Action: CoreShowChannels\r\n\r\n');
	for (var i in confs) {
	    client.write('Action: ConfBridgeList\r\nConference: '+confs[i]['conf']+'\r\n\r\n');
	}
    }
}

function conflist() {
//    console.log("conflist()");
    client.write('Action: ConfBridgeListRooms\r\n\r\n');
    setTimeout(memberlist,100);
}

var cl_inv;

var suspend=1;
var hm_requests=0;

function suspender() {
    if (hm_requests==0) {
	clearInterval(cl_inv);
	cl_inv=setInterval(conflist,10000);
	suspend=1;
    }
    hm_requests=0;
//    console.log("demand(): suspend="+suspend);
}

function wakeup() {
    conflist();
    clearInterval(cl_inv);
    cl_inv=setInterval(conflist,1000);
    suspend=0;
//    console.log("wakeup(): suspend="+suspend);
}

setInterval(suspender,30000);

var act={

'stat':function() {
    return "{ \"requests\": "+ hm_requests-- +" }";

},

'list':function(conf) {
    if (!conf)
	return JSON.stringify(confs);
    if (conf=="all")
	return JSON.stringify(members);
    if (members[conf])
	return JSON.stringify(members[conf]);
    return "{}";
},

'kick':function(conf,chan) {
    if (!conf || !chan) 
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("kick " + conf + " " + chan);
    client.write('Action: ConfBridgeKick\r\nConference: '+conf+'\r\nChannel: '+chan+'\r\n\r\n');
    return "{ \"retcode\": 0 }";

},

'mute':function(conf,chan) {
    if (!conf || !chan) 
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("mute " + conf + " " + chan);
    client.write('Action: ConfBridgeMute\r\nConference: '+conf+'\r\nChannel: '+chan+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
},

'unmute':function(conf,chan) {
    if (!conf || !chan) 
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("unmute " + conf + " " + chan);
    client.write('Action: ConfBridgeUnmute\r\nConference: '+conf+'\r\nChannel: '+chan+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
},

'lock':function(conf) {
    if (!conf)
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("lock " + conf);
    client.write('Action: ConfbridgeLock\r\nConference: '+conf+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
},

'unlock':function(conf) {
    if (!conf)
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("unlock " + conf);
    client.write('Action: ConfbridgeUnlock\r\nConference: '+conf+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
},

'rec_start':function(conf) {
    if (!conf)
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("start recording " + conf);
    client.write('Action: ConfbridgeStartRecord\r\nConference: '+conf+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
},

'rec_stop':function(conf) {
    if (!conf)
	return "{ \"retcode\": -1, \"error\": \"wrong args\"}"; 

//    console.log("stop recording " + conf);
    client.write('Action: ConfbridgeStartRecord\r\nConference: '+conf+'\r\n\r\n');
    return "{ \"retcode\": 0 }";
}

};

http.createServer(function(request, response) {
//    console.log(request.connection);
    response.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});

    var arg=request.url.split('\?')[0].split('\/');

    if (arg[1] in act) {
        if (suspend) 
	    wakeup()

	hm_requests++;

	var chan=null;
	if (arg[3] && arg[4])
	     chan=arg[3]+"/"+arg[4];

        response.write(act[arg[1]](arg[2],chan));
    }

    response.end();
}).listen(8985);
