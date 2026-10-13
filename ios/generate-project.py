from pathlib import Path
import hashlib
root=Path(__file__).resolve().parent
sources=sorted((root/'EnglishPrinter').glob('*.swift'))
uid=lambda s:hashlib.sha1(s.encode()).hexdigest()[:24].upper()
lines=['// !$*UTF8*$!','{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {']
def obj(key,value):lines.append(uid(key)+' = { '+value+' };')
refs=[];build=[]
obj("config",'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config.xcconfig; sourceTree = "<group>";')
refs.append(uid("config"))
for source in sources:
    ref='src:'+source.name;bf='build:'+source.name;refs.append(uid(ref));build.append(uid(bf))
    obj(ref,f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = EnglishPrinter/{source.name}; sourceTree = "<group>";')
    obj(bf,f'isa = PBXBuildFile; fileRef = {uid(ref)};')
for name,path in [('web','../web'),('lpapi','../printer/lpapi.cjs'),('assets','EnglishPrinter/Assets.xcassets')]:
    ref='ref:'+name;bf='build:'+name;refs.append(uid(ref))
    obj(ref,f'isa = PBXFileReference; lastKnownFileType = {"folder" if name=="web" else ("folder.assetcatalog" if name=="assets" else "text")}; path = "{path}"; sourceTree = "<group>";')
    obj(bf,f'isa = PBXBuildFile; fileRef = {uid(ref)};')
obj('product','isa = PBXFileReference; explicitFileType = wrapper.application; path = EnglishPrinter.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj('group','isa = PBXGroup; children = ('+','.join(refs+[uid('product')])+'); sourceTree = "<group>";')
obj('sources','isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join(build)+'); runOnlyForDeploymentPostprocessing = 0;')
obj('resources','isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ('+uid('build:web')+','+uid('build:lpapi')+','+uid('build:assets')+'); runOnlyForDeploymentPostprocessing = 0;')
obj('frameworks','isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
for scope in ['project','target']:
    for config in ['Debug','Release']:
        settings='DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; SWIFT_OPTIMIZATION_LEVEL = '+('"-Onone"' if config=='Debug' else '"-O"')+';'
        if config=='Debug': settings+=' SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;'
        if scope=='target': settings+=' ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; PRODUCT_NAME = EnglishPrinter; INFOPLIST_FILE = EnglishPrinter/Info.plist; CODE_SIGN_STYLE = Automatic; TARGETED_DEVICE_FAMILY = 1; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; ENABLE_USER_SCRIPT_SANDBOXING = YES;'
        base = ('baseConfigurationReference = '+uid('config')+'; ') if scope=='target' else ''
        obj(scope+config,f'isa = XCBuildConfiguration; name = {config}; {base}buildSettings = {{ {settings} }};')
    obj(scope+'configs','isa = XCConfigurationList; buildConfigurations = ('+uid(scope+'Debug')+','+uid(scope+'Release')+'); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
obj('target','isa = PBXNativeTarget; name = EnglishPrinter; productName = EnglishPrinter; productType = "com.apple.product-type.application"; productReference = '+uid('product')+'; buildConfigurationList = '+uid('targetconfigs')+'; buildPhases = ('+','.join(uid(x) for x in ['sources','frameworks','resources'])+'); buildRules = (); dependencies = ();')
obj('project','isa = PBXProject; attributes = { LastUpgradeCheck = 2640; }; buildConfigurationList = '+uid('projectconfigs')+'; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh_CN; knownRegions = (zh_CN,en,Base); mainGroup = '+uid('group')+'; projectDirPath = ""; projectRoot = ""; targets = ('+uid('target')+');')
lines+=['}; rootObject = '+uid('project')+'; }']
(root/'EnglishPrinter.xcodeproj/project.pbxproj').write_text('\n'.join(lines))
