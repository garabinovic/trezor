package com.trezor.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.trezor.app.attachments.TrezorAttachmentsPackage
import com.trezor.app.backup.TrezorBackupPackage
import com.trezor.app.reminders.TrezorRemindersPackage
import com.trezor.app.storage.TrezorDatabaseFilesPackage
import com.trezor.app.vault.TrezorVaultPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(TrezorVaultPackage())
          add(TrezorDatabaseFilesPackage())
          add(TrezorRemindersPackage())
          add(TrezorAttachmentsPackage())
          add(TrezorBackupPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
