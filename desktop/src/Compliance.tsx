import { Alert } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ipc } from './api';
const reminderSchema = z.object({ dueCount:z.number().int().nonnegative(), dueItems:z.number().int().nonnegative(), overdueCount:z.number().int().nonnegative(), unprintedCount:z.number().int().nonnegative(), hasReminder:z.boolean(), date:z.string() });
export function complianceUrl(server:string) { return new URL('/compliance/?embedded=1',server).href; }
export function useComplianceReminders(server:string) {
 const [reminder,setReminder]=useState<z.infer<typeof reminderSchema>|null>(null);
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{if(!server)return;try{const value=await ipc(window.desktop.complianceReminders(),reminderSchema);setReminder(value);setError('');}catch(e){setError(e instanceof Error?e.message:'合规提醒读取失败');}},[server]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),30_000);const onFocus=()=>void refresh();const onMessage=(event:MessageEvent<unknown>)=>{if(!server||event.origin!==new URL(server).origin)return;const value=z.object({type:z.literal('compliance:changed')}).safeParse(event.data);if(value.success)void refresh();};window.addEventListener('focus',onFocus);window.addEventListener('message',onMessage);return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);window.removeEventListener('message',onMessage);};},[server,refresh]);
 return {reminder,error,refresh};
}
export function Compliance({server,error}:{server:string;error:string}) {
 return <section className="compliance-workspace">{error&&<Alert type="warning" showIcon message={`合规提醒暂未更新：${error}`} />}<iframe title="食品安全周期合规工作台" className="compliance-frame" src={complianceUrl(server)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" /></section>;
}
