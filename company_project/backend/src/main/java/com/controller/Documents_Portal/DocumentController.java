package com.controller.Documents_Portal;

import java.time.LocalDateTime;
import java.util.List;

import com.entity.Document;
import com.repository.DocumentRepository;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/documents")
@CrossOrigin(origins = "http://localhost:5173")
public class DocumentController {

    @Autowired
    private DocumentRepository repository;

    // ================= SAVE =================
    @PostMapping
    public ResponseEntity<?> saveDocument(@RequestBody Document document) {
        try {
            System.out.println("SAVE API HIT");
            document.setCreatedDatetime(LocalDateTime.now());
            Document saved = repository.save(document);
            return ResponseEntity.ok(saved);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    // ================= UPDATE (needed for the Edit button) =================
    @PutMapping("/{id}")
    public ResponseEntity<?> updateDocument(@PathVariable Long id, @RequestBody Document document) {
        try {
            System.out.println("UPDATE API HIT for id=" + id);

            if (!repository.existsById(id)) {
                return ResponseEntity.notFound().build();
            }

            document.setId(id); // make sure we overwrite the existing row, not create a new one
            Document updated = repository.save(document);
            return ResponseEntity.ok(updated);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    // ================= DELETE (needed for the Delete button) =================
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteDocument(@PathVariable Long id) {
        try {
            System.out.println("DELETE API HIT for id=" + id);

            if (!repository.existsById(id)) {
                return ResponseEntity.notFound().build();
            }

            repository.deleteById(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    // ================= GET BY TYPE =================
    @GetMapping("/type/{type}")
    public List<Document> getByType(@PathVariable String type) {
        if (type.equalsIgnoreCase("All")) {
            return repository.findAll();
        }
        return repository.findByJobType(type);
    }

    // ================= GET ALL =================
    @GetMapping
    public List<Document> getAll(
        @RequestParam(required = false) String fromDate,
        @RequestParam(required = false) String toDate,
        @RequestParam(required = false) String type
    ) {
        if (fromDate != null && toDate != null) {
            return repository.findByDateRange(fromDate, toDate);
        }

        if (type != null && !type.equalsIgnoreCase("All")) {
            return repository.findByJobType(type);
        }

        return repository.findAll();
    }
}