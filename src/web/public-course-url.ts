export function publicCourseUrl(value:string):string {
  const url=new URL(value);
  for(const key of [...url.searchParams.keys()])if(/token|secret|password|authorization|credential|ticket|signature|^sign$|^auth$|^code$/i.test(key))url.searchParams.delete(key);
  if(/token|password|secret|authorization|credential/i.test(url.hash))url.hash='';
  return url.href;
}

export function publicMediaIdentity(value:string):string|null {
  const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return null;
  const publicUrl=new URL(publicCourseUrl(value));
  for(const key of [...publicUrl.searchParams.keys()])if(/expires?|timestamp|^x-(?:amz|oss)-|^policy$|^_(?:t|ts)?$|^ts?$|^deadline$/i.test(key))publicUrl.searchParams.delete(key);
  publicUrl.hash='';return publicUrl.href;
}
