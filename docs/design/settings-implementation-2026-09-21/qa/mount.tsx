import '/src/components/social-delivery.css';
import '/src/styles.css';
import '/src/desk-design.css';
import '/src/reader-design.css';
import '/src/strategy-design.css';
import '/src/swiss-design.css';
import '/src/settings-design.css';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AISettingsPage } from '/src/components/AISettingsPage';
import { SchedulePage } from '/src/components/SchedulePage';
import { AppShell } from '/src/components/AppShell';
import fixture from './fixture.json';
const noop=async()=>undefined;
const usage={stateBytes:1024,backupBytes:0,databaseBytes:2048,legacyStateBytes:0,mediaBytes:0,materialBytes:0,jobBytes:0,totalBytes:3072};
const loadUsage=async()=>usage;
const health={codex:{ok:false,detail:'示例：尚未测试'},horizon:{ok:true,detail:'示例环境'},publisher:{ok:false,detail:'示例：未连接',installPath:'/example/chrome-extension'}};
function SettingsAcceptance(){
 const [page,setPage]=useState(location.hash==='#schedule'?'schedule':'ai-settings');
 const [ai,setAi]=useState(fixture.aiSettings);
 const [settings,setSettings]=useState(fixture.settings);
 const [notice,setNotice]=useState('');
 const flash=(text)=>{setNotice(text);setTimeout(()=>setNotice(''),3000)};
 const navigate=(next)=>{if(!['schedule','ai-settings'].includes(next)){flash('本验收页仅展示两页设置，其余页面未改。');return}setPage(next);location.hash=next};
 const testProvider=async(id)=>{const p=ai.providers.find(p=>p.id===id);const result={providerId:id,lastCheckedAt:new Date().toISOString(),status:'healthy',latencyMs:80,model:p.model,errorCategory:'none',safeMessage:'示例测试结果',testedConfig:{model:p.model,baseUrl:p.baseUrl}};setAi(a=>({...a,latestProviderHealth:{...a.latestProviderHealth,[id]:result}}));return result};
 const saveProvider=async(id,patch)=>setAi(a=>({...a,activeProviderId:patch.active?id:a.activeProviderId,providers:a.providers.map(p=>p.id===id?{...p,...patch,apiKeyConfigured:patch.clearApiKey?false:patch.apiKey?true:p.apiKeyConfigured}:p)}));
 return <><div style={{position:'relative',zIndex:100,height:32,background:'#f4f4f1',fontSize:11,padding:'8px 18px',color:'#797c72'}}>真实组件验收 · 示例数据 · 操作仅保存在本页内存，不连接正式服务</div><AppShell page={page} onNavigate={navigate} notifications={[]} notificationsMuted={false} onToggleNotificationsMuted={noop} onMarkNotificationRead={noop} onMarkAllNotificationsRead={noop} onOpenNotification={noop}>
 {notice?<div role="status" style={{padding:14,background:'#f9f1ed'}}>{notice}</div>:null}
 {page==='ai-settings'?<AISettingsPage aiSettings={ai} spendingPolicy={settings.spendingPolicy} materials={[]} onSaveSpendingPolicy={async(spendingPolicy)=>setSettings(s=>({...s,spendingPolicy}))} onSaveProvider={saveProvider} onTestProvider={testProvider} onSaveAgentRole={async(role,id)=>setAi(a=>({...a,[role+'ProviderId']:id}))} onSaveCompletionProvider={async(id)=>setAi(a=>({...a,completionProviderId:id}))} onSaveWritingReviewMode={async(mode)=>setAi(a=>({...a,writingReviewMode:mode}))} onSaveSkill={async(id,enabled)=>setAi(a=>({...a,skills:a.skills.map(s=>s.id===id?{...s,enabled}:s)}))} onImportSkill={noop} onUploadMaterial={noop} onImportMaterial={noop} onDeleteMaterial={noop}/>:<SchedulePage settings={settings} runs={[]} health={health} onSettings={patch=>setSettings(s=>({...s,...patch}))} onRefreshHealth={()=>flash('示例环境：未发起外部检查')} onLaunchPublisher={()=>flash('验收页不启动浏览器')} onOpenRuns={()=>flash('验收数据没有运行记录')} onLoadStorageUsage={loadUsage} onExportData={noop} onExportPortableArchive={noop} onInspectPortableArchive={async()=>{throw Error('验收页不导入归档')}} onImportPortableArchive={async()=>{throw Error('验收页不导入归档')}} onRestoreData={noop} onSaveWeChatSettings={async(patch)=>{const next={...settings.wechat,...patch,appSecretConfigured:Boolean(patch.appSecret)||settings.wechat.appSecretConfigured};delete next.appSecret;setSettings(s=>({...s,wechat:next}));return next}} onTestWeChatConnection={async()=>({ok:false,status:'error',checkedAt:new Date().toISOString(),detail:'示例：未连接真实公众号'})}/>}
 </AppShell></>;
}
const root=createRoot(document.getElementById('root'));
root.render(<SettingsAcceptance/>);
if(import.meta.hot) import.meta.hot.dispose(()=>root.unmount());
