import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;

/** Temporary, hash-pinned fix for Manhwa18.cc 1.6.62's post-ID regression. */
public final class Manhwa18PostIdFix {
    private static final String SHA256 =
            "874f0239f1a46d9caece3979fc786ad21ffd582544b7233ed2b0385248605171";
    private static final String CLASS = "eu/kanade/tachiyomi/b/a/g";
    private static final String UPDATE = "(L" + CLASS
            + ";Leu/kanade/tachiyomi/source/model/SManga;Ljava/util/List;ZZ"
            + "Lkotlin/coroutines/Continuation;)Ljava/lang/Object;";

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected input.jar output.jar");
        Path input = Path.of(args[0]);
        Path output = Path.of(args[1]);
        byte[] original = Files.readAllBytes(input);
        String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original));
        if (!SHA256.equals(digest)) throw new IllegalArgumentException("Unexpected upstream JAR: " + digest);
        if (Files.exists(output)) throw new IllegalArgumentException("Output already exists");

        int[] patched = {0};
        try (var source = new ZipInputStream(new java.io.ByteArrayInputStream(original));
             var destination = new ZipOutputStream(Files.newOutputStream(output))) {
            ZipEntry entry;
            while ((entry = source.getNextEntry()) != null) {
                String name = entry.getName();
                // Editing bytecode invalidates the upstream signature. Suwayomi accepts unsigned JARs.
                if (name.equals("META-INF/CERT.SF") || name.equals("META-INF/CERT.RSA")
                        || name.equals("META-INF/MANIFEST.MF")) continue;
                byte[] bytes = source.readAllBytes();
                if (name.equals(CLASS + ".class")) {
                    ClassReader reader = new ClassReader(bytes);
                    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
                    reader.accept(new ClassVisitor(Opcodes.ASM8, writer) {
                        @Override
                        public MethodVisitor visitMethod(int access, String method, String descriptor,
                                                         String signature, String[] exceptions) {
                            MethodVisitor delegate = super.visitMethod(access, method, descriptor, signature, exceptions);
                            boolean update = method.equals("a") && descriptor.equals(UPDATE);
                            boolean chapter = method.equals("a") && descriptor.equals(
                                    "(Lorg/jsoup/nodes/Element;Ljava/lang/String;)Leu/kanade/tachiyomi/source/model/SChapter;");
                            boolean chapterUrl = method.equals("getChapterUrl") && descriptor.equals(
                                    "(Leu/kanade/tachiyomi/source/model/SChapter;)Ljava/lang/String;");
                            if (!update && !chapter && !chapterUrl) return delegate;
                            return new MethodVisitor(Opcodes.ASM8, delegate) {
                                @Override
                                public void visitMethodInsn(int opcode, String owner, String name,
                                                            String desc, boolean isInterface) {
                                    if (chapterUrl && opcode == Opcodes.INVOKESPECIAL
                                            && owner.equals("keiyoushi/source/d") && name.equals("getChapterUrl")) {
                                        // The new superclass concatenates baseUrl and chapter.url;
                                        // URI resolution also supports legacy absolute chapter URLs.
                                        super.visitInsn(Opcodes.POP2);
                                        super.visitVarInsn(Opcodes.ALOAD, 0);
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, CLASS, "getBaseUrl",
                                                "()Ljava/lang/String;", false);
                                        super.visitMethodInsn(Opcodes.INVOKESTATIC, "java/net/URI", "create",
                                                "(Ljava/lang/String;)Ljava/net/URI;", false);
                                        super.visitVarInsn(Opcodes.ALOAD, 1);
                                        super.visitMethodInsn(Opcodes.INVOKEINTERFACE,
                                                "eu/kanade/tachiyomi/source/model/SChapter", "getUrl", "()Ljava/lang/String;", true);
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/net/URI", "resolve",
                                                "(Ljava/lang/String;)Ljava/net/URI;", false);
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/net/URI", "toString",
                                                "()Ljava/lang/String;", false);
                                        patched[0]++;
                                        return;
                                    }
                                    if (chapter && opcode == Opcodes.INVOKEINTERFACE
                                            && owner.equals("eu/kanade/tachiyomi/source/model/SChapter")
                                            && name.equals("setUrl") && desc.equals("(Ljava/lang/String;)V")) {
                                        // Preserve MadaraLegacy chapter identity, including its reader suffix.
                                        super.visitInsn(Opcodes.POP);
                                        super.visitVarInsn(Opcodes.ALOAD, 1);
                                        super.visitLdcInsn("a");
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "org/jsoup/nodes/Element",
                                                "selectFirst", "(Ljava/lang/String;)Lorg/jsoup/nodes/Element;", false);
                                        super.visitLdcInsn("abs:href");
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "org/jsoup/nodes/Element",
                                                "attr", "(Ljava/lang/String;)Ljava/lang/String;", false);
                                        super.visitLdcInsn("\\?style=(?:paged|list).*$");
                                        super.visitLdcInsn("");
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String",
                                                "replaceFirst", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;", false);
                                        super.visitLdcInsn("?style=list");
                                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String",
                                                "concat", "(Ljava/lang/String;)Ljava/lang/String;", false);
                                        patched[0]++;
                                    }
                                    super.visitMethodInsn(opcode, owner, name, desc, isInterface);
                                    if (update && opcode == Opcodes.INVOKESTATIC && owner.equals(CLASS)
                                            && name.equals("c")
                                            && desc.equals("(Lorg/jsoup/nodes/Document;)Ljava/lang/String;")) {
                                        // fetchMangaUpdate: document.mangaId().orEmpty(). This provider
                                        // has supportsPostId=false and reads chapters from the page.
                                        super.visitLdcInsn("");
                                        super.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Objects",
                                                "toString", "(Ljava/lang/Object;Ljava/lang/String;)Ljava/lang/String;", false);
                                        patched[0]++;
                                    }
                                }
                            };
                        }
                    }, 0);
                    bytes = writer.toByteArray();
                }
                ZipEntry replacement = new ZipEntry(name);
                replacement.setTime(0);
                destination.putNextEntry(replacement);
                destination.write(bytes);
                destination.closeEntry();
            }
        } catch (Exception error) {
            Files.deleteIfExists(output);
            throw error;
        }
        if (patched[0] != 3) {
            Files.delete(output);
            throw new IOException("Expected three patch sites, found " + patched[0]);
        }
        System.out.println("Patched post-ID lookup and legacy chapter URLs: " + output);
    }
}
