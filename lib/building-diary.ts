import type { Attachment } from './beta';
export type DiaryHeader = {project:string;projectNumber:string;orderNumber:string;customer:string;address:string;author:string;siteManager:string;siteManagerId:string};
export type Personnel = {trade:string;company:string;count:number|string;hours:number|string};
export type DiaryContent = {weather:string[];temperature:string;personnel:Personnel[];work:string;deliveries:string;equipment:string;deviations:string;decisions:string;safety:string;quality:string;nextDay:string;files:Attachment[]};
export type DiaryReport = {id:string;order:string;author:string;date:string;submittedAt?:string;updatedAt:string;header:DiaryHeader;content:DiaryContent};
export type InboxItem = {recipient?:string;id:string;order:string;report?:string;kind:'diary'|'completed';at:string;readAt?:string;title:string;sender:string};
export const diaryTexts = [['work','Utförda arbeten'],['deliveries','Leveranser'],['equipment','Maskiner och utrustning'],['deviations','Avvikelser och hinder'],['decisions','Beslut och åtgärder'],['safety','Arbetsmiljö och säkerhet'],['quality','Kvalitet'],['nextDay','Planering för nästa arbetsdag']] as const;
export const emptyDiary = ():DiaryContent => ({weather:[],temperature:'',personnel:[],work:'',deliveries:'',equipment:'',deviations:'',decisions:'',safety:'',quality:'',nextDay:'',files:[]});
