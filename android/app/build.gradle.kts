import java.io.File
import java.util.Properties
import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

plugins {
    // AGP 9 compiles Kotlin itself; the separate kotlin-android plugin is gone.
    alias(libs.plugins.android.application)
}

android {
    namespace = "toys.touchgrass"
    compileSdk = 37

    defaultConfig {
        applicationId = "toys.touchgrass"
        minSdk = 24
        targetSdk = 37
        versionCode = 3
        versionName = "0.3"
    }

    /* The release key. Kept outside the repository — a keystore in a
       working tree is one `git clean` away from being gone, and losing it
       means never being able to update the app for anyone who installed
       it. Its location and password live in android/keystore.properties,
       which is gitignored; without that file the release build still
       configures, it just produces an unsigned APK. */
    signingConfigs {
        create("release") {
            val props = Properties()
            val file = rootProject.file("keystore.properties")
            if (file.exists()) {
                file.inputStream().use { stream -> props.load(stream) }
                storeFile = File(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Only sign when the properties file is actually present, so a
            // fresh clone can still build a debug APK without the key.
            if (rootProject.file("keystore.properties").exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

/* ==========================================================
   The web app one directory up is the single source of truth.
   It gets copied into the APK's assets at build time, so there
   is never a second copy to keep in sync by hand.
   ========================================================== */

abstract class CopyWebAppTask : DefaultTask() {

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceFiles: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copyThem() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()

        val missing = mutableListOf<String>()
        sourceFiles.forEach { file ->
            if (!file.exists()) missing += file.name
            else file.copyTo(out.resolve(file.name), overwrite = true)
        }
        // Better a failed build than an APK containing half a website.
        if (missing.isNotEmpty()) {
            throw GradleException("Web app files missing: $missing")
        }
    }
}

val webAppFiles = listOf(
    "index.html", "settings.html", "style.css",
    // scoring.js is not just a page asset: the background worker evaluates
    // it directly, so it must be in the APK.
    "scoring.js", "blend.js", "lang.js", "core.js", "app.js", "settings.js",
    "calendar.html", "record.js"
)

// The web app lives one level up, in web/. It is the source of truth for
// both the site and the app.
val webAppDir = "../web"

val copyWebApp = tasks.register<CopyWebAppTask>("copyWebApp") {
    description = "Copies the Touch Grass web app into the APK's assets."
    sourceFiles.setFrom(webAppFiles.map { rootProject.file("$webAppDir/$it") })
}

// The unit test runs the real scoring.js, so tell it where that file is.
tasks.withType<Test>().configureEach {
    // So File("../web/...") in the tests resolves from android/, matching
    // where the web app actually lives relative to this module.
    workingDir = rootProject.projectDir
    systemProperty("touchgrass.scoring.js", rootProject.file("../web/scoring.js").absolutePath)
    systemProperty("touchgrass.blend.js", rootProject.file("../web/blend.js").absolutePath)
    // The tests read the web app by path, which Gradle cannot see, so a
    // change to blend.js alone would otherwise leave them "up to date".
    inputs.dir(rootProject.file("../web")).withPropertyName("webApp")
}

androidComponents {
    onVariants { variant ->
        // Wires the task into the build graph and its output into assets.
        variant.sources.assets?.addGeneratedSourceDirectory(
            copyWebApp,
            CopyWebAppTask::outputDir
        )
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.work)
    implementation(libs.rhino)

    testImplementation(libs.junit)
    testImplementation(libs.rhino)
    // Android's org.json is a build-time stub that throws on every call in
    // JVM tests; this real implementation lets the test parse Scoring.blend's
    // JSON output directly.
    testImplementation("org.json:json:20231013")
}
