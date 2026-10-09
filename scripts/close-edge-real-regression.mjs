import {ownedBrowserConnection} from './owned-browser.mjs';
import {CdpClient,cdpJson} from './cdp-client.mjs';
const connection=await ownedBrowserConnection(process.argv[2]??'.browser-regression-runtime/course-login-20261004-040551/connection-login-ready.json');
const browser=new CdpClient((await cdpJson(connection.port,'/json/version')).webSocketDebuggerUrl);
try{await browser.send('Browser.close');}finally{browser.close();}
