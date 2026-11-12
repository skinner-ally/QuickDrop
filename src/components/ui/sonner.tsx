"use client"

import { useTheme } from "@/components/layout/ThemeProvider"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Icon } from "@/components/icons"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <Icon name="circle-check" strokeWidth={2} className="size-4" />
        ),
        info: (
          <Icon name="info" strokeWidth={2} className="size-4" />
        ),
        warning: (
          <Icon name="alert" strokeWidth={2} className="size-4" />
        ),
        error: (
          <Icon name="error" strokeWidth={2} className="size-4" />
        ),
        loading: (
          <Icon name="loader" strokeWidth={2} className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
