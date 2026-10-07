import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react(),{name:'isolated-settings-fixtures',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/')req.url='/docs/design/settings-implementation-2026-09-21/qa/index.html';if(req.url?.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.statusCode=403;res.end(JSON.stringify({error:'验收页不连接实际接口'}));return}res.end(JSON.stringify({settings:{enabled:false,extensionId:'',tokenConfigured:false},address:'ws://127.0.0.1:19527',connected:false,detail:'示例数据：未连接同步助手',accounts:[]}));return}next()})}}],server:{host:'127.0.0.1',port:4388,strictPort:true}});
await server.listen();
console.log('Isolated settings acceptance: http://127.0.0.1:4388/');
