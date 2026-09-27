export const root:string;
export function safeState(candidate:string,allowed?:string):string;
export function freePort(port:number):Promise<boolean>;
export function modeGuard(mode:string,host:string):void;
export function backupGuard():never;
