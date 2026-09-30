import { QueryClient } from '@tanstack/react-query';
import type { User, Workspace } from '../../shared/types';
export const queryClient = new QueryClient({defaultOptions:{queries:{staleTime:60_000,retry:1,refetchOnWindowFocus:false}}});
let csrf='';
export async function session(){const data=await request<{user:User|null;csrfToken:string}>('/session');csrf=data.csrfToken;return data;}
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.method&&options.method!=='GET'?{'X-CSRF-Token':csrf}:{}),...options.headers}});
 const data=await response.json().catch(()=>({error:'The server returned an unreadable response. Please try again.'}));
 if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);
 return data as T;
}
export function post<T>(path:string,body:unknown={}){return request<T>(path,{method:'POST',body:JSON.stringify(body)});}
export async function authenticate(path:string,body:unknown={}) {await session();await post(path,body);const s=await session();queryClient.clear();queryClient.setQueryData(['session'],s);return s;}
export const workspaceQuery={queryKey:['workspace'],queryFn:()=>request<Workspace>('/workspace')};
export function invalidateWorkspace(){return queryClient.invalidateQueries({queryKey:['workspace']});}
