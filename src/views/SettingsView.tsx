import { useSettings } from '@/db/settings'
import { AboutSection } from './settings/AboutSection'
import { AiSection } from './settings/AiSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { CategoriesSection } from './settings/CategoriesSection'
import { DataSection } from './settings/DataSection'
import { LinksSection } from './settings/LinksSection'
import { ShortcutsSection } from './settings/ShortcutsSection'
import { TagsSection } from './settings/TagsSection'

export function SettingsView() {
  const settings = useSettings()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6">
        <h1 className="font-heading text-lg font-medium">Настройки</h1>
        {settings ? (
          <>
            <AppearanceSection settings={settings} />
            <CategoriesSection />
            <TagsSection />
            <LinksSection settings={settings} />
            <AiSection settings={settings} />
            <ShortcutsSection settings={settings} />
            <DataSection />
            <AboutSection />
          </>
        ) : (
          <p className="text-2sm text-muted-foreground">Загрузка…</p>
        )}
      </div>
    </div>
  )
}

export default SettingsView
