import { useSettings } from '@/db/settings'

/**
 * Удалённые превью и иконки ссылок грузятся с чужих хостов, поэтому показываются только при включённой
 * настройке «Автоматически подтягивать заголовок страницы» (иначе единственные сетевые запросы — явные).
 */
export function useRemoteImagesAllowed(): boolean {
  return useSettings()?.autoFetchLinkTitle === true
}
